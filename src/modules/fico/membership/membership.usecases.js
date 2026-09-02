import { DomainError } from '../../../shared/errors.js'
import { jobQueue } from '../../../shared/adapters/jobs/postgres-queue.adapter.js'
import { getLatestJobByEnrollment } from './membership.ports.js'
import { membershipRepository } from './membership.repository.js'
import {
  MEMBERSHIP_ACTIVATION_WINDOW_MONTHS,
  isMembership,
  validateActivationDateFormat,
  classifyActivation,
  assertReschedulable,
  resolveMembershipChannels
} from './membership.entity.js'
import { odoo } from '../../../shared/adapters/odoo/odoo.adapter.js'
import { buildUniqueOdooEmail, buildOdooNameParts, resolveOdooLogin } from '../../../utils/fico-odoo.helper.js'
import { toRescheduleDto } from './membership.dto.js'

// Orquestacion del subdominio membership. No contiene SQL (delega en el
// repository) ni el calculo de ventana TZ Lima (vive en SQL del repository).
// Las reglas puras (formato de fecha, clasificacion, defensa de diferido) viven
// en membership.entity.js.
//
// Las membresias pueden activarse hoy (flujo sincrono) o en una fecha futura
// dentro de una ventana de 6 meses (flujo diferido via job 'membership_activation'
// a las 09:00 Lima). Por eso enrollMembershipInOdoo NO lanza: devuelve
// { success, ... } para que el worker decida reintentos.
//
// El correo de bienvenida NO vive aca: lo manda sendMembershipEmail de
// email-confirmation.usecases.js, que es el unico que aplica la cascada de CC
// (requires_email_cc). Este modulo solo resuelve Odoo y la fecha de activacion.

const repo = membershipRepository
const password = '1234567'

// Reprograma la fecha de activacion de una membresia ya confirmada. FICO solo
// puede mover la fecha mientras el correo de bienvenida NO se haya enviado.
// Lanza DomainError (status preservado) cuando la operacion no es valida; en el
// camino feliz persiste, reagenda o crea el job y deja audit log.
export async function updateMembershipActivationDate ({ enrollmentId, newDate, userId }) {
  if (!enrollmentId) throw new DomainError('enrollment_id requerido')
  if (!newDate) throw new DomainError('newDate requerido')

  const fmt = validateActivationDateFormat(newDate)
  if (!fmt.ok) throw new DomainError('newDate debe ser YYYY-MM-DD')

  const probe = await repo.findMembershipProbeWithEmailState(enrollmentId)
  const c = probe
    ? await repo.resolveActivationWindow(fmt.value, MEMBERSHIP_ACTIVATION_WINDOW_MONTHS)
    : null

  const classification = c
    ? classifyActivation({
        isTodayOrPast: c.is_today_or_past,
        outOfWindow: c.out_of_window,
        activationDate: c.activation_date,
        runAt: c.run_at
      })
    : { mode: 'invalid' }

  assertReschedulable(
    {
      found: !!probe,
      isMembershipProgram: probe ? isMembership(probe.abbreviation, probe.is_membership) : false,
      emailAlreadySent: probe?.email_already_sent
    },
    classification
  )

  if (classification.mode === 'invalid') throw new DomainError('Fecha no se pudo parsear')

  await repo.setActivationDate(enrollmentId, classification.activationDate)

  // Reagenda el job pendiente si existe; sino encola uno nuevo (caso edge: legacy
  // sin encolar, o el anterior ya termino done/failed).
  let job = await getLatestJobByEnrollment(enrollmentId, 'membership_activation')
  if (job && job.status === 'pending') {
    await jobQueue.rescheduleJob({ jobId: job.job_id, runAt: classification.runAt })
  } else {
    job = await jobQueue.enqueue({
      jobType: 'membership_activation',
      enrollmentId,
      payload: { enrollmentId },
      runAt: classification.runAt
    })
  }

  await repo.logAudit({
    enrollmentId,
    action: 'membership_activation_rescheduled',
    userId,
    details: `Nueva fecha: ${classification.activationDate} 09:00 (job=${job?.job_id ?? '-'})`
  })

  return toRescheduleDto({ job, activationDate: classification.activationDate })
}

// Inscribe la membresia en TODOS los cursos online de Odoo (no un curso
// especifico). Contrato no-lanzante: cualquier throw se captura y se devuelve
// como { success: false, error }. Exportada para el job worker
// (membership_activation step 'odoo').
export async function enrollMembershipInOdoo ({ enrollmentId }) {
  try {
    return await enrollMembershipInOdooInner({ enrollmentId })
  } catch (err) {
    console.error('[enrollMembershipInOdoo] Throw inesperado:', err.message, err.stack)
    return { success: false, error: `enrollMembershipInOdoo: ${err.message}`, odoo_user_id: null }
  }
}

async function enrollMembershipInOdooInner ({ enrollmentId }) {
  const data = await repo.findEnrollmentForOdoo(enrollmentId)
  if (!data) throw new Error('Inscripcion no encontrada')

  // Defensa: si la membresia esta diferida (activacion futura), abortamos antes
  // de tocar Odoo. El job encolado la procesara al llegar la fecha. Cubre el caso
  // de un caller que dispara esto sin saber que estaba diferida.
  if (data.is_deferred) {
    return {
      success: true,
      deferred: true,
      scheduled_for: data.membership_activation_date,
      odoo_user_id: null,
      message: 'Activacion diferida — job en cola la procesara al llegar la fecha'
    }
  }

  // names/surnames: campos partidos del partner que lee Certificacion.
  // fullName = "APELLIDOS NOMBRES", materno incluido.
  const { names, surnames } = buildOdooNameParts({
    firstName: data.first_name,
    lastName: data.last_name,
    motherLastName: data.mother_last_name
  })
  const fullName = `${surnames} ${names}`.trim()
  // createEmail UNICO: si otro alumno con apellido.nombre ya tiene ese login en
  // Odoo, buildUniqueOdooEmail agrega sufijo numerico para evitar reutilizar el
  // user de otra persona.
  const createEmail = await buildUniqueOdooEmail(data.first_name, data.last_name, data.document_number)

  // Mismo resolver que el sync de cursos: user previo -> DNI en Odoo -> correo
  // real -> sintetico. Antes solo miraba el DNI previo, asi que a un alumno con
  // cuenta Odoo creada por otro flujo le abria un usuario duplicado
  // apellido.nombre@...
  const prevOdooUserId = await repo.findPreviousOdooUserByDocument(data.document_number)
  const searchEmail = await resolveOdooLogin({
    prevOdooUserId,
    documentNumber: data.document_number,
    originEmail: data.origin_email,
    createEmail
  })
  if (searchEmail !== createEmail) {
    console.log(`[enrollMembershipInOdoo] enrollment ${enrollmentId}: reusando usuario Odoo existente (${searchEmail})`)
  }

  // Catalogo curado en Configuracion. Sin lista guardada, resolveMembershipChannels
  // devuelve todos los publicados (usedFallback) para no activar membresias vacias.
  const [publishedChannels, configuredIds] = await Promise.all([
    odoo.listOnlineChannels(),
    repo.findMembershipCourseIds()
  ])
  const { channels, usedFallback } = resolveMembershipChannels(publishedChannels, configuredIds)
  if (usedFallback) {
    console.warn(`[enrollMembershipInOdoo] enrollment ${enrollmentId}: sin catalogo de membresia configurado, se inscribe en los ${channels.length} cursos publicados`)
  }

  const result = await odoo.enrollInAllOnlineCourses({
    searchEmail,
    createEmail,
    fullName,
    password,
    phone: data.origin_phone,
    documentNumber: data.document_number,
    names,
    surnames,
    channels
  })

  if (result.success) {
    const odooEmailFinal = result.odoo_login || createEmail
    await repo.saveOdooCredentials({
      enrollmentId,
      odooUserId: result.odoo_user_id,
      odooEmail: odooEmailFinal,
      odooPassword: result.password_set || null
    })
  }

  // Las membresias inscriben en TODOS los cursos online del Campus, no a un curso
  // especifico. La etiqueta deja el audit log claro.
  return {
    ...result,
    course_search: usedFallback
      ? `Todos los cursos online (${channels.length}) — catalogo sin configurar`
      : `Catalogo de membresia (${channels.length} cursos)`
  }
}
