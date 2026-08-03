import { DomainError, NotFoundError } from '../../../shared/errors.js'
import { jobQueue } from '../../../shared/adapters/jobs/postgres-queue.adapter.js'
import { getLatestJobByEnrollment } from './membership.ports.js'
import { membershipRepository } from './membership.repository.js'
import {
  MEMBERSHIP_ACTIVATION_WINDOW_MONTHS,
  isMembership,
  validateActivationDateFormat,
  classifyActivation,
  outOfWindowMessage,
  assertReschedulable
} from './membership.entity.js'
import { odoo } from '../../../shared/adapters/odoo/odoo.adapter.js'
import { buildUniqueOdooEmail, buildOdooNameParts } from '../../../utils/fico-odoo.helper.js'
import {
  MEMBERSHIP_DURATION_MONTHS,
  formatCalendarDate,
  addMonthsCalendar
} from '../../../utils/fico-formatters.js'
import { email } from '../../../shared/adapters/email/email.adapter.js'
import { buildMembresiaHTML, detectMembershipType } from '../../../templates/bienvenida-membresia.js'
import { toRescheduleDto } from './membership.dto.js'

// Orquestacion del subdominio membership. No contiene SQL (delega en el
// repository) ni el calculo de ventana TZ Lima (vive en SQL del repository).
// Las reglas puras (formato de fecha, clasificacion, defensa de diferido) viven
// en membership.entity.js.
//
// Las membresias pueden activarse hoy (flujo sincrono) o en una fecha futura
// dentro de una ventana de 6 meses (flujo diferido via job 'membership_activation'
// a las 09:00 Lima). Los efectos externos lentos (Odoo, correo) se disparan
// EXACTAMENTE como el legacy: sincronos cuando la activacion es inmediata, o por
// el job cuando es diferida. Por eso enrollMembershipInOdoo/sendMembershipEmail
// NO lanzan: devuelven { success, ... } para que el worker decida reintentos.

const repo = membershipRepository
const password = '1234567'

// Resuelve si la confirmacion de pago debe diferir la activacion de membresia.
// Lee is_membership de BD (no del frontend) y valida la fecha contra la ventana
// de N meses en TZ Lima. Consumida por confirmPayment ANTES de correr el SP.
//
// Devuelve:
//   { isMembership: false }
//   { isMembership: true, deferred: false, activationDate }
//   { isMembership: true, deferred: true, activationDate, runAt }
//   { error: '<motivo>' }
export async function resolveMembershipActivation (payload) {
  const enrollmentId = payload?.enrollment_id
  if (!enrollmentId) return { isMembership: false }

  const probe = await repo.findMembershipProbe(enrollmentId)
  if (!probe || !isMembership(probe.abbreviation, probe.is_membership)) {
    return { isMembership: false }
  }

  // Sin fecha: comportamiento legacy (activacion inmediata, sin persistir
  // membership_activation_date para no alterar los correos que dependen de
  // pe.start_date).
  const raw = payload.activation_date
  if (!raw) return { isMembership: true, deferred: false, activationDate: null }

  const fmt = validateActivationDateFormat(raw)
  if (!fmt.ok) return { error: fmt.error }

  const c = await repo.resolveActivationWindow(fmt.value, MEMBERSHIP_ACTIVATION_WINDOW_MONTHS)
  if (!c) return { error: 'activation_date no se pudo parsear' }

  const decision = classifyActivation({
    isTodayOrPast: c.is_today_or_past,
    outOfWindow: c.out_of_window,
    activationDate: c.activation_date,
    runAt: c.run_at
  })

  if (decision.mode === 'out_of_window') return { error: outOfWindowMessage() }
  if (decision.mode === 'immediate') {
    return { isMembership: true, deferred: false, activationDate: decision.activationDate }
  }
  return { isMembership: true, deferred: true, activationDate: decision.activationDate, runAt: decision.runAt }
}

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

  // Si la persona (mismo DNI) ya tiene odoo_user_id, reusamos su login. Sino,
  // searchEmail = createEmail (garantizado disponible) y Odoo crea user nuevo.
  let searchEmail = createEmail
  const prevOdooUserId = await repo.findPreviousOdooUserByDocument(data.document_number)
  if (prevOdooUserId) {
    const existingUser = await odoo.callKw('res.users', 'read', [
      [prevOdooUserId], ['login']
    ]).catch(() => null)
    if (existingUser?.[0]?.login) {
      searchEmail = existingUser[0].login
    }
  }

  const result = await odoo.enrollInAllOnlineCourses({
    searchEmail,
    createEmail,
    fullName,
    password,
    phone: data.origin_phone,
    documentNumber: data.document_number,
    names,
    surnames
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
  return { ...result, course_search: 'Todos los cursos online' }
}

// Envia el correo de bienvenida de membresia. Contrato no-lanzante. Exportada
// para el job worker (membership_activation step 'email').
export async function sendMembershipEmail ({ enrollmentId }) {
  try {
    return await sendMembershipEmailInner({ enrollmentId })
  } catch (err) {
    console.error('[sendMembershipEmail] Throw inesperado:', err.message, err.stack)
    return { success: false, error: `sendMembershipEmail: ${err.message}` }
  }
}

async function sendMembershipEmailInner ({ enrollmentId }) {
  let data = await repo.findEnrollmentForEmail(enrollmentId)
  if (!data) return { success: false, error: 'Inscripcion no encontrada' }

  // Defensa: si la activacion todavia es futura, el correo NO sale hoy — el job
  // en cola lo mandara al llegar la fecha. success=true para que callers que
  // reintentan (UI "reenviar") no muestren error.
  if (data.membership_activation_date && await repo.isActivationDateDeferred(data.membership_activation_date)) {
    return {
      success: true,
      deferred: true,
      scheduled_for: data.membership_activation_date,
      message: 'Correo diferido — el job en cola lo enviara al llegar la fecha de activacion'
    }
  }

  const toEmail = data.origin_email
  if (!toEmail) return { success: false, error: 'Sin correo registrado' }

  // Sin odoo_user_id intentamos crear el usuario + inscribirlo en todos los
  // cursos online ANTES de mandar el correo. Sin user creado las credenciales no
  // funcionan: preferimos no mandar nada a mandar credenciales falsas.
  if (!data.odoo_user_id) {
    console.log(`[sendMembershipEmail] enrollment ${enrollmentId}: sin odoo_user_id, ejecutando enrollMembershipInOdoo`)
    const odooRes = await enrollMembershipInOdoo({ enrollmentId })
    if (!odooRes?.success) {
      const errMsg = odooRes?.error || 'fallo desconocido al crear usuario en Odoo'
      console.error(`[sendMembershipEmail] No se pudo crear user en Odoo para enrollment ${enrollmentId}: ${errMsg}`)
      return {
        success: false,
        error: `No se creo usuario en Odoo (${errMsg}). El correo NO fue enviado para evitar entregar credenciales falsas.`
      }
    }
    data = (await repo.findEnrollmentForEmail(enrollmentId)) || data
  }

  if (!data.odoo_email) {
    return {
      success: false,
      error: 'No se pudo determinar odoo_email tras la inscripcion. Email no enviado.'
    }
  }

  // Prioridad: fecha pedida > start_date de la edicion > hoy. Identica a
  // previewMembershipEmail para que preview y envio real muestren la misma fecha.
  const rawStart = data.membership_activation_date || data.start_date
  const startDate = rawStart ? new Date(rawStart) : new Date()
  const fechaAct = formatCalendarDate(startDate)
  const fechaRenov = formatCalendarDate(addMonthsCalendar(startDate, MEMBERSHIP_DURATION_MONTHS))

  // El cronograma solo se muestra en pagos por cuotas. En pago al contado el SP
  // genera un installment_number=1 con el total, que al alumno le confunde.
  let installmentsHTML = ''
  const isSinglePayment = data.payment_plan_alias === 'we_payment_way_single'
  if (!isSinglePayment) {
    const instRows = await repo.findInstallments(enrollmentId)
    if (instRows && instRows.length > 0) {
      const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
      const fechasCells = instRows.map(i => {
        const d = new Date(i.due_date)
        return `<td><font face="Tahoma" size="2">${String(d.getUTCDate()).padStart(2, '0')} ${meses[d.getUTCMonth()]}</font></td>`
      }).join('')
      const pagosCells = instRows.map(i => `<td><font face="Tahoma" size="2">${data.currency_symbol || 'S/.'} ${Math.trunc(Number(i.amount || 0))}</font></td>`).join('')
      installmentsHTML = `
        <table width="450" border="2" align="center" style="border-collapse:collapse;text-align:center;">
          <thead><tr><td colspan="${instRows.length + 1}" style="background-color:rgb(5,36,103);color:white;"><font face="Tahoma" size="2">CRONOGRAMA DE PAGOS</font></td></tr></thead>
          <tbody>
            <tr><td style="background-color:rgb(5,36,103);color:white;"><font face="Tahoma" size="2">Fechas</font></td>${fechasCells}</tr>
            <tr><td style="background-color:rgb(5,36,103);color:white;"><font face="Tahoma" size="2">Pago</font></td>${pagosCells}</tr>
          </tbody>
        </table>`
    }
  }

  // REENVIO vs primer envio: el primero muestra credenciales (USUARIO + 1234567);
  // el reenvio solo USUARIO + link de recuperacion, para no mandar el password en
  // multiples correos.
  const isFirstSend = !(await repo.hasPriorMembershipSend(enrollmentId))

  const htmlBody = buildMembresiaHTML({
    studentName: [data.first_name, data.last_name, data.mother_last_name].filter(Boolean).join(' '),
    programName: data.program_name,
    email: data.odoo_email,
    password,
    isNew: isFirstSend,
    duracion: `${MEMBERSHIP_DURATION_MONTHS} meses`,
    fechaActivacion: fechaAct,
    fechaRenovacion: fechaRenov,
    installmentsHTML,
    bloqueBeneficios: undefined,
    fichaRegistroLink: undefined
  })

  const tipo = detectMembershipType(data.program_name)
  const subject = `Bienvenido a tu Membresia ${tipo} - WE Educacion`
  // Las membresias se mandan desde pagos@we-educacion.com (mismo sender que el GAS).
  const result = await email.sendEmail({
    to: toEmail,
    subject,
    htmlBody,
    fromEmail: 'pagos@we-educacion.com',
    fromName: 'WE Educacion Ejecutiva'
  })

  try {
    await repo.logEmail({
      enrollmentId,
      toEmail,
      subject,
      messageId: result.messageId || null,
      status: result.success ? 'sent' : 'failed'
    })
  } catch (logErr) {
    console.error('[EmailLog] Error:', logErr.message)
  }

  return result
}
