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
  buildMembershipExpiries,
  resolveMembershipChannels,
  describeActivationJob,
  assertActivationRetryable
} from './membership.entity.js'
import { odoo } from '../../../shared/adapters/odoo/odoo.adapter.js'
import { buildOdooNameParts, buildUniqueOdooEmail, resolveOdooLogin } from '../../../utils/fico-odoo.helper.js'
import { ODOO_DEFAULT_PASSWORD } from '../odoo-sync/odoo-sync.entity.js'
import { toRescheduleDto } from './membership.dto.js'

// Orquestacion del subdominio membership. No contiene SQL (delega en el
// repository) ni el calculo de ventana TZ Lima (vive en SQL del repository).
// Las reglas puras (formato de fecha, clasificacion, defensa de diferido) viven
// en membership.entity.js.
//
// Las membresias pueden activarse hoy (flujo sincrono) o en una fecha futura
// dentro de una ventana de 6 meses (flujo diferido via job 'membership_activation'
// a las 09:00 Lima).
//
// El correo de bienvenida NO vive aca: lo manda sendMembershipEmail de
// email-confirmation.usecases.js, que es el unico que aplica la cascada de CC
// (requires_email_cc). Este modulo solo resuelve la fecha de activacion.

const repo = membershipRepository

// Reprograma la fecha de activacion de una membresia ya confirmada. FICO solo
// puede mover la fecha mientras los cursos NO se hayan abierto en Odoo.
// Lanza DomainError (status preservado) cuando la operacion no es valida; en el
// camino feliz persiste, reagenda o crea el job y deja audit log.
export async function updateMembershipActivationDate ({ enrollmentId, newDate, userId }) {
  if (!enrollmentId) throw new DomainError('enrollment_id requerido')
  if (!newDate) throw new DomainError('newDate requerido')

  const fmt = validateActivationDateFormat(newDate)
  if (!fmt.ok) throw new DomainError('newDate debe ser YYYY-MM-DD')

  const probe = await repo.findMembershipProbeWithActivationState(enrollmentId)
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
      alreadyActivated: probe?.already_activated
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

// Cuenta Odoo del socio para el correo de bienvenida. Si ya tiene una (alumno
// de un curso previo) se reusa su login; si no, se crea la @weeducacion con la
// clave por defecto y SIN cursos (los abre 'membership_activation').
// Pedido de FICO (14/10/26, acotado el 20/10/26): solo las membresias de
// fico/inscripciones/new NO crean usuario (el area lo hace a mano). Esas pasan
// por register_followup -> enrollMembershipInOdoo y nunca llegan aca: este
// paso es exclusivo de confirmPayment (venta desde lead, B2B). Apagarlo aqui
// tambien dejo sin cursos a esas ventas (23288, 19/10/26).
// Job worker: 'membership_welcome', step 'account'.
export async function createMembershipOdooUser ({ enrollmentId }) {
  try {
    const data = await repo.findEnrollmentForOdoo(enrollmentId)
    if (!data) throw new Error('Inscripcion no encontrada')
    const account = await findExistingOdooAccount(data)
    if (!account) return await createMembershipAccount(enrollmentId, data)
    await repo.saveOdooCredentials({ enrollmentId, odooUserId: account.id, odooEmail: account.login, odooPassword: null })
    return { success: true, reused: true, odoo_user_id: account.id, odoo_login: account.login }
  } catch (err) {
    console.error('[createMembershipOdooUser] Throw inesperado:', err.message, err.stack)
    return { success: false, error: `createMembershipOdooUser: ${err.message}`, odoo_user_id: null }
  }
}

// Misma convencion que el flujo de cursos: login unico {apellido}.{nombre}
// @weeducacion.edu.pe y ODOO_DEFAULT_PASSWORD. channels [] = usuario sin cursos.
async function createMembershipAccount (enrollmentId, data) {
  const login = await buildUniqueOdooEmail(data.first_name, data.last_name, data.document_number)
  const { names, surnames } = buildOdooNameParts({
    firstName: data.first_name,
    lastName: data.last_name,
    motherLastName: data.mother_last_name
  })
  const result = await odoo.enrollInAllOnlineCourses({
    searchEmail: login,
    createEmail: login,
    fullName: `${surnames} ${names}`.trim(),
    password: ODOO_DEFAULT_PASSWORD,
    phone: data.origin_phone,
    documentNumber: data.document_number,
    names,
    surnames,
    channels: []
  })
  if (!result.success) return { success: false, error: `Alta Odoo ${login}: ${result.error}`, odoo_user_id: null }
  await repo.saveOdooCredentials({ enrollmentId, odooUserId: result.odoo_user_id, odooEmail: login, odooPassword: ODOO_DEFAULT_PASSWORD })
  return { success: true, created: true, odoo_user_id: result.odoo_user_id, odoo_login: login }
}

// Cuenta Odoo que el socio ya tiene, o null. Nunca crea: misma cadena que el
// sync de cursos (user previo -> DNI en Odoo -> correo real).
async function findExistingOdooAccount (data) {
  const login = await resolveOdooLogin({
    prevOdooUserId: await repo.findPreviousOdooUserByDocument(data.document_number),
    documentNumber: data.document_number,
    originEmail: data.origin_email,
    createEmail: null
  })
  if (!login) return null
  const user = await odoo.searchUserByEmail(login)
  return user ? { id: user.id, login: user.login } : null
}

// Activacion (15/10/26): los cursos del catalogo SI los abre el ERP, pero solo
// sobre una cuenta Odoo que ya exista (la creo la bienvenida o, en /new, el
// area a mano). Sin cuenta devuelve error: el job reintenta con backoff y,
// agotado, queda 'failed' para que FICO lo relance. Contrato
// no-lanzante: el worker decide los reintentos.
export async function enrollMembershipInOdoo ({ enrollmentId }) {
  try {
    return await activateMembershipCourses(enrollmentId)
  } catch (err) {
    console.error('[enrollMembershipInOdoo] Throw inesperado:', err.message, err.stack)
    return { success: false, error: `enrollMembershipInOdoo: ${err.message}`, odoo_user_id: null }
  }
}

async function activateMembershipCourses (enrollmentId) {
  const data = await repo.findEnrollmentForOdoo(enrollmentId)
  if (!data) throw new Error('Inscripcion no encontrada')

  // Diferida: el job encolado la procesa al llegar la fecha.
  if (data.is_deferred) {
    return {
      success: true,
      deferred: true,
      scheduled_for: data.membership_activation_date,
      odoo_user_id: null,
      message: 'Activacion diferida — job en cola la procesara al llegar la fecha'
    }
  }

  const account = await findExistingOdooAccount(data)
  if (!account) {
    return {
      success: false,
      odoo_user_id: null,
      error: `El socio (DNI ${data.document_number || '-'}, ${data.origin_email || 'sin correo'}) no tiene usuario en Odoo: el area debe crearlo y relanzar la activacion`
    }
  }

  const [publishedChannels, configuredIds] = await Promise.all([
    odoo.listOnlineChannels(),
    repo.findMembershipCourseIds()
  ])
  const { channels, usedFallback } = resolveMembershipChannels(publishedChannels, configuredIds)
  if (usedFallback) {
    console.warn(`[enrollMembershipInOdoo] enrollment ${enrollmentId}: sin catalogo de membresia configurado, se inscribe en los ${channels.length} cursos publicados`)
  }

  const { names, surnames } = buildOdooNameParts({
    firstName: data.first_name,
    lastName: data.last_name,
    motherLastName: data.mother_last_name
  })
  // searchEmail = createEmail = login existente: el adapter encuentra la cuenta
  // y nunca llega a su rama de alta (password null por lo mismo).
  const result = await odoo.enrollInAllOnlineCourses({
    searchEmail: account.login,
    createEmail: account.login,
    fullName: `${surnames} ${names}`.trim(),
    password: null,
    phone: data.origin_phone,
    documentNumber: data.document_number,
    names,
    surnames,
    channels
  })

  if (result.success) {
    await repo.saveOdooCredentials({
      enrollmentId,
      odooUserId: result.odoo_user_id,
      odooEmail: result.odoo_login || account.login,
      odooPassword: null
    })
  }

  return {
    ...result,
    course_search: usedFallback
      ? `Todos los cursos online (${channels.length}) — catalogo sin configurar`
      : `Catalogo de membresia (${channels.length} cursos)`
  }
}

// Estado del ultimo job de activacion, para la ficha de la inscripcion.
export async function getMembershipActivationStatus ({ enrollmentId }) {
  const job = await getLatestJobByEnrollment(enrollmentId, 'membership_activation')
  return describeActivationJob(job)
}

// Relanza una activacion que agoto sus reintentos. Encola un job nuevo (no
// resucita el fallido) para que el historial conserve el intento y su error.
export async function retryMembershipActivation ({ enrollmentId, userId }) {
  const probe = await repo.findMembershipProbeWithActivationState(enrollmentId)
  const failed = await getLatestJobByEnrollment(enrollmentId, 'membership_activation')
  assertActivationRetryable({
    found: !!probe,
    isMembershipProgram: probe ? isMembership(probe.abbreviation, probe.is_membership) : false,
    job: failed
  })

  const job = await jobQueue.enqueue({
    jobType: 'membership_activation',
    enrollmentId,
    payload: { enrollmentId }
  })

  await repo.logAudit({
    enrollmentId,
    action: 'membership_activation_retried',
    userId,
    details: `Reintento manual de la activacion (job fallido=${failed.job_id}, nuevo job=${job.job_id})`
  })

  return describeActivationJob({ ...job, attempts: 0 })
}

// Socios de membresia con su vencimiento y estado (vigente / por vencer /
// vencida) para que FICO llame a tiempo a los que deben renovar.
export async function listMembershipExpiries () {
  const rows = await repo.listMembershipStarts()
  return buildMembershipExpiries(rows, rows[0]?.today)
}
