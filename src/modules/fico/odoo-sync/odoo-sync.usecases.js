import { odoo } from '../../../shared/adapters/odoo/odoo.adapter.js'
import { ALIAS } from '../../../utils/catalog-aliases.js'
import { getCatalogIdByAlias } from '../../../utils/catalog-helper.js'
import { safeAsync } from '../../../shared/utils/safe-async.js'
import { buildUniqueOdooEmail, buildOdooNameParts } from '../../../utils/fico-odoo.helper.js'
import { isMembership } from '../../../utils/fico-formatters.js'
import { isEventEnrollment } from '../../../shared/event-category.js'
import { odooSyncRepository } from './odoo-sync.repository.js'
import {
  ODOO_DEFAULT_PASSWORD,
  isE0Parent,
  resolveCurrencyCode,
  buildOdooFullName,
  buildPresentialCourseName,
  resolveSearchEmail,
  normalizeOriginEmail,
  mapInstallmentsForOdoo
} from './odoo-sync.entity.js'

// Orquestacion del sync Odoo de inscripciones de cursos. No contiene SQL
// (delega en el repository) ni reglas puras (delega en la entity). Los efectos
// Odoo se disparan via el cliente Odoo legacy, identico al service original;
// candidato a vivir detras de un OdooPort cuando shared lo exponga completo.

const repo = odooSyncRepository

// Puerto de salida para derivar el flujo de membresia. Vive en otro subdominio
// (membership_activation); el orquestador lo inyecta con setMembershipPort para
// evitar dependencia circular. Default: deriva al cliente Odoo no aplica, por lo
// que se mantiene null hasta que se cablee.
let membershipPort = null
export function setMembershipPort (fn) {
  membershipPort = fn
}

// Pre-chequea si el enrollment ya esta en Odoo (idempotencia) o si es de
// membresia (otro flujo). Devuelve `{ skip: true, result }` para early-return
// desde enrollInOdoo, o `null` cuando hay que continuar con el sync.
async function preCheck (enrollmentId) {
  const chk = await repo.findPreCheck(enrollmentId)

  if (chk && isMembership(chk.abbreviation, chk.is_membership)) {
    if (!membershipPort) throw new Error('enrollMembershipInOdoo no esta cableado')
    return { skip: true, result: await membershipPort({ enrollmentId }) }
  }
  if (chk?.odoo_order_id) {
    console.log(`[enrollInOdoo] Skip — enrollment ${enrollmentId} ya tiene odoo_order_id=${chk.odoo_order_id}`)
    return {
      skip: true,
      result: {
        success: true,
        skipped: true,
        odoo_user_id: chk.odoo_user_id,
        odoo_student_id: chk.odoo_student_id,
        odoo_email: chk.odoo_email,
        order_id: chk.odoo_order_id
      }
    }
  }
  return null
}

// Crea la sale order Odoo con las cuotas planificadas y activa los fees.
// Se ejecuta despues del sync del usuario. Si falla la creacion de la orden,
// loguea pero no revierte el sync — el alumno queda en Odoo, solo le falta la
// cobranza, que FICO puede crear manualmente.
async function createOdooOrderAndActivate ({ enrollmentId, result, odooActivation, slideGroupId, createEmail }) {
  try {
    const instRows = await repo.findInstallments(enrollmentId)
    const enrollData = await repo.findEnrollmentAmounts(enrollmentId)

    const netAmount = Number(enrollData?.total_amount) || 0
    const currencyCode = resolveCurrencyCode(enrollData?.currency_alias)

    const orderResult = await odoo.createSaleOrderWithFees({
      partnerId: result.odoo_partner_id,
      productName: odooActivation,
      slideGroupId,
      amount: netAmount,
      currency: currencyCode,
      partnerEmail: createEmail,
      installments: mapInstallmentsForOdoo(instRows)
    })

    if (orderResult.success) {
      await repo.updateOdooOrderId(enrollmentId, orderResult.order_id)

      // Activar cuotas: pasar de 'borrador' a 'pendiente' inmediatamente.
      // Aplica para TODOS los flujos (FICO directo, courseChange, E0 children, etc.)
      // sin esperar a confirmPayment.
      await safeAsync('[enrollInOdoo][Odoo] activateFees', async () => {
        const activated = await odoo.activateFees(orderResult.order_id)
        if (activated?.activated > 0) {
          await repo.logAudit({
            enrollmentId,
            action: 'odoo_fees_activated',
            userId: null,
            details: `${activated.activated} cuota(s) Odoo activadas (Borrador -> Pendiente)`
          })
        }
      })
    }
  } catch (orderErr) {
    console.error('[enrollInOdoo] Error creando orden de venta:', orderErr.message, orderErr.data || '')
  }
}

// Sincroniza la inscripcion de un curso con Odoo: crea/encuentra al alumno,
// genera la orden de venta con cuotas y activa los fees. Firma compatible con el
// job-worker (step odoo de register_followup).
export async function enrollInOdoo ({ enrollmentId }) {
  // Un congreso no se dicta en el campus: no hay curso al que inscribir ni
  // odoo_activation configurado. Sin este skip el step 'odoo' del job
  // register_followup revienta con "El programa no tiene configurado
  // odoo_activation" y el step 'email' (que va despues) nunca corre: la
  // inscripcion al evento se queda sin correo de confirmacion.
  if (await isEventEnrollment(enrollmentId)) {
    console.log(`[enrollInOdoo] Skip - enrollment #${enrollmentId} es de evento/congreso (no se dicta en el campus).`)
    return { success: true, skipped: true, reason: 'event', odoo_user_id: null }
  }

  // Skip si la inscripcion esta en E0 (program_edition_id NULL) Y es padre con hijos.
  // En ese caso los hijos se inscriben individualmente; el padre no se sincroniza con Odoo.
  const e0Check = await repo.findE0Check(enrollmentId)
  if (e0Check && isE0Parent({ programEditionId: e0Check.program_edition_id, childrenCount: e0Check.children_count })) {
    console.log(`[enrollInOdoo] Skip - enrollment #${enrollmentId} en E0 (padre sin edicion programada). Hijos se inscriben individualmente.`)
    return { success: true, skipped: true, reason: 'e0_parent', odoo_user_id: null }
  }

  const skip = await preCheck(enrollmentId)
  if (skip) return skip.result

  const data = await repo.findEnrollmentForSync(enrollmentId)
  if (!data) throw new Error('Inscripcion no encontrada')

  const odooActivation = (data.odoo_activation || '').trim()
  if (!odooActivation) throw new Error('El programa no tiene configurado odoo_activation')

  const onlineModalityId = await getCatalogIdByAlias(ALIAS.MODALITY_ONLINE)
  const isOnline = data.cat_model_modality === onlineModalityId

  const prevOdoo = await repo.findPrevOdooUser(data.document_number)

  const createEmail = await buildUniqueOdooEmail(data.first_name, data.last_name, data.document_number)

  // Resolucion del searchEmail (login a buscar en Odoo) en orden de prioridad:
  //   1) Login del odoo_user_id que TENEMOS guardado para este DNI en otro
  //      enrollment previo. Es la fuente mas confiable porque la mapeamos nosotros.
  //   2) origin_email del alumno (su correo real). Cubre alumnos con cuenta Odoo
  //      desde flujos antiguos (GAS, manual, otro sistema) que nuestra BD nunca
  //      registro, evitando duplicados con login sintetico.
  //   3) Synthetic createEmail (apellido.nombre@weeducacion.edu.pe) — fallback
  //      cuando es un alumno realmente nuevo.
  //
  // El search en Odoo es por `res.users.login` (clave unica), no por
  // `partner.email` — ese es el motivo del filtro estricto en searchUserByEmail.
  let prevUserLogin = null
  let existingByRealLogin = null

  if (prevOdoo?.odoo_user_id) {
    const existingUser = await odoo.callKw('res.users', 'read', [
      [prevOdoo.odoo_user_id], ['login']
    ]).catch(() => null)
    prevUserLogin = existingUser?.[0]?.login || null
  } else {
    const realEmail = normalizeOriginEmail(data.origin_email)
    if (realEmail) {
      const existingByReal = await odoo.searchUserByEmail(realEmail).catch(() => null)
      if (existingByReal?.login) {
        console.log(`[enrollInOdoo] enrollment ${enrollmentId}: alumno antiguo encontrado en Odoo por origin_email (${realEmail}) -> user ${existingByReal.id}`)
        existingByRealLogin = existingByReal.login
      }
    }
  }

  const searchEmail = resolveSearchEmail({
    createEmail,
    prevUserLogin,
    originEmail: data.origin_email,
    existingUserByRealEmailLogin: existingByRealLogin
  })
  const fullName = buildOdooFullName({
    firstName: data.first_name,
    lastName: data.last_name,
    motherLastName: data.mother_last_name
  })
  // names/surnames: campos partidos del partner que lee Certificacion.
  const { names, surnames } = buildOdooNameParts({
    firstName: data.first_name,
    lastName: data.last_name,
    motherLastName: data.mother_last_name
  })
  const password = ODOO_DEFAULT_PASSWORD

  let searchName
  let slideGroupId = null
  let slideChannelId = null
  let result

  if (isOnline) {
    searchName = odooActivation
    const channels = await odoo.searchSlideChannelByName(odooActivation)
    const channelMatch = channels.find(c => c.name === odooActivation) || channels[0]
    if (!channelMatch) throw new Error(`Curso online no encontrado en Odoo: "${odooActivation}"`)
    slideChannelId = channelMatch.id

    result = await odoo.syncStudentToOdooOnline({
      searchEmail,
      createEmail,
      fullName,
      password,
      slideChannelId,
      phone: data.origin_phone,
      documentNumber: data.document_number,
      names,
      surnames
    })
  } else {
    const startDate = data.start_date
    if (!startDate) throw new Error('La edicion no tiene fecha de inicio')
    searchName = buildPresentialCourseName({ odooActivation, startDate })

    const groups = await odoo.searchSlideGroup(odooActivation)
    const match = groups.find(g => g.name === searchName)
    if (!match) throw new Error(`Curso no encontrado en Odoo: "${searchName}"`)
    slideGroupId = match.id

    result = await odoo.syncStudentToOdoo({
      searchEmail,
      createEmail,
      fullName,
      password,
      slideGroupId,
      phone: data.origin_phone,
      documentNumber: data.document_number,
      names,
      surnames
    })
  }

  if (result.success) {
    const odooEmailFinal = result.odoo_login || createEmail
    await repo.updateOdooUser({
      enrollmentId,
      odooUserId: result.odoo_user_id,
      odooStudentId: result.odoo_student_id,
      passwordSet: result.password_set,
      odooEmail: odooEmailFinal
    })

    await createOdooOrderAndActivate({ enrollmentId, result, odooActivation, slideGroupId, createEmail })

    await repo.logAudit({ enrollmentId, action: 'odoo_enrolled', userId: null, details: `Inscrito en Odoo: user ${result.odoo_user_id}, curso ${searchName}` })
  }

  return {
    ...result,
    student_name: fullName,
    student_email: searchEmail,
    odoo_email: createEmail,
    course_search: searchName
  }
}

// Marca la siguiente cuota pendiente de la orden Odoo como pagada. Best-effort:
// los errores se capturan y devuelven en el shape de respuesta, no se lanzan.
export async function syncInstallmentPaymentToOdoo ({ enrollmentId, installmentNumber }) {
  try {
    const data = await repo.findInstallmentSyncData(enrollmentId)

    if (isMembership(data?.abbreviation, data?.is_membership)) return { success: false, error: 'Membresias no sincronizan cuotas con Odoo' }
    if (!data?.odoo_order_id) return { success: false, error: 'Sin orden Odoo asociada' }

    const fees = await odoo.callKw('sale.order.fee', 'search_read', [
      [['order_id', '=', data.odoo_order_id], ['state', '=', 'pendiente']]
    ], { fields: ['id', 'seq', 'amount'], limit: 20, order: 'seq asc' })

    if (!fees || fees.length === 0) return { success: false, error: 'No hay cuotas pendientes en Odoo' }

    const fee = fees[0]
    await odoo.markFeeAsPaid(fee.id)

    return { success: true, fee_id: fee.id, message: `Cuota ${fee.seq} marcada como pagada en Odoo` }
  } catch (err) {
    console.error('[syncInstallmentPaymentToOdoo]', err.message)
    return { success: false, error: err.message }
  }
}
