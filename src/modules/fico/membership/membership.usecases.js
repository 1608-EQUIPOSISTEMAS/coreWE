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
  buildMembershipExpiries
} from './membership.entity.js'
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

// Pedido de FICO (14/10/26): el ERP NO toca Odoo en las membresias. La alta
// automatica dejaba socios a medias (el curso aparecia en su campus pero no
// estaba inscrito como participante y Odoo lo botaba al entrar a la clase), y
// el area prefiere crear usuario e inscripcion a mano. Ambos jobs
// ('membership_welcome' step account, 'membership_activation' step odoo) y el
// preCheck de enrollInOdoo siguen llamando aca: devolver success los cierra
// limpio sin reintentos. El correo de bienvenida usa el correo registrado.
const ODOO_SKIPPED = Object.freeze({
  success: true,
  skipped: true,
  odoo_user_id: null,
  message: 'Membresia: el ERP no crea usuario ni inscribe cursos en Odoo (manual)'
})

export async function createMembershipOdooUser () {
  return ODOO_SKIPPED
}

export async function enrollMembershipInOdoo () {
  return ODOO_SKIPPED
}

// Socios de membresia con su vencimiento y estado (vigente / por vencer /
// vencida) para que FICO llame a tiempo a los que deben renovar.
export async function listMembershipExpiries () {
  const rows = await repo.listMembershipStarts()
  return buildMembershipExpiries(rows, rows[0]?.today)
}
