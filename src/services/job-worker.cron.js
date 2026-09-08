// Worker de la cola fico_jobs.
//
// Polea cada 5 segundos: reclama 1 job pendiente con SKIP LOCKED, lo ejecuta
// segun job_type, y marca done/failed. Si falla, la propia cola decide retry
// con backoff o failed (ver job-queue.service.js).
//
// Convencion de current_step: representa el ULTIMO paso COMPLETADO. null = none.
// En retry, el handler resume desde el siguiente paso al ultimo completado.
//
// Apagable con env var FICO_JOB_WORKER_DISABLED=true.

import cron from 'node-cron'
import { claimNextJob, completeJob, failJob, updateCurrentStep, reapStaleJobs } from './job-queue.service.js'
import '../modules/fico/fico.bootstrap.js'
import { createChildEnrollments } from '../modules/fico/validation/validation.usecases.js'
import { enrollInOdoo } from '../modules/fico/odoo-sync/odoo-sync.usecases.js'
import { sendConfirmationEmail, sendMembershipEmail } from '../modules/fico/email-confirmation/email-confirmation.usecases.js'
import { enrollMembershipInOdoo, createMembershipOdooUser } from '../modules/fico/membership/membership.usecases.js'

// Steps del job 'register_followup' en orden topologico de dependencias.
// children DEBE correr primero (puede mutar program_edition_id a NULL si E0).
// odoo DEBE correr antes de email (email lee odoo_user_id).
const REGISTER_FOLLOWUP_STEPS = ['children', 'odoo', 'email']

// La membresia se parte en dos jobs porque el socio recibe la bienvenida el dia
// que se inscribe, pero el acceso a los cursos empieza en la fecha de activacion
// que el mismo eligio:
//   'membership_welcome'    (ya) -> account: crea el usuario Odoo SIN cursos,
//                                   email: bienvenida con credenciales reales.
//   'membership_activation' (en la fecha) -> odoo: le abre los cursos.
// El email lee odoo_email persistido por el step account.
const MEMBERSHIP_WELCOME_STEPS = ['account', 'email']

const handlers = {
  /**
   * Inscripcion post-registro: hijos -> Odoo -> email.
   * payload: { enrollmentId, userId, cc? }
   * current_step: null | 'children' | 'odoo' | 'email' (ultimo completado)
   */
  async register_followup (job) {
    const { enrollment_id: enrollmentId, current_step: completed, payload } = job
    const userId = payload?.userId ?? null
    const cc = payload?.cc ?? null
    const sapUsername = payload?.sapUsername ?? null
    const sapPassword = payload?.sapPassword ?? null

    const startIdx = completed ? REGISTER_FOLLOWUP_STEPS.indexOf(completed) + 1 : 0
    const result = { skipped: [] }

    if (startIdx <= 0) {
      try {
        await createChildEnrollments({ enrollmentId, userId })
        await updateCurrentStep(job.job_id, 'children')
      } catch (err) {
        throw Object.assign(err, { _failStep: 'children' })
      }
    } else {
      result.skipped.push('children')
    }

    if (startIdx <= 1) {
      try {
        const odoo = await enrollInOdoo({ enrollmentId })
        result.odoo = odoo
        await updateCurrentStep(job.job_id, 'odoo')
      } catch (err) {
        throw Object.assign(err, { _failStep: 'odoo' })
      }
    } else {
      result.skipped.push('odoo')
    }

    if (startIdx <= 2) {
      try {
        const email = await sendConfirmationEmail({ enrollmentId, cc, sapUsername, sapPassword })
        result.email = { success: !!email?.success, messageId: email?.messageId, error: email?.error }
        // sendConfirmationEmail no tira — devuelve { success: false, error } en fallos
        // 'lentos' (Odoo no creado, etc.). Tratamos como fallo del step para que
        // el retry vuelva a intentar mas tarde con backoff.
        if (!email?.success) {
          throw Object.assign(new Error(email?.error || 'Email no enviado'), { _failStep: 'email' })
        }
        await updateCurrentStep(job.job_id, 'email')
      } catch (err) {
        if (!err._failStep) err._failStep = 'email'
        throw err
      }
    } else {
      result.skipped.push('email')
    }

    return result
  },

  /**
   * Bienvenida de membresia: account -> email. Corre el dia de la inscripcion,
   * sin importar cuando activo el socio. Encolado por confirmPayment.
   *
   * payload: { enrollmentId } — el resto se lee de la BD para evitar staleness.
   * current_step: null | 'account' | 'email' (ultimo completado).
   */
  async membership_welcome (job) {
    const { enrollment_id: enrollmentId, current_step: completed } = job
    const startIdx = completed ? MEMBERSHIP_WELCOME_STEPS.indexOf(completed) + 1 : 0
    const result = { skipped: [] }

    if (startIdx <= 0) {
      try {
        const odoo = await createMembershipOdooUser({ enrollmentId })
        result.account = odoo
        if (!odoo?.success) {
          throw Object.assign(new Error(odoo?.error || 'Alta del usuario Odoo fallo'), { _failStep: 'account' })
        }
        await updateCurrentStep(job.job_id, 'account')
      } catch (err) {
        if (!err._failStep) err._failStep = 'account'
        throw err
      }
    } else {
      result.skipped.push('account')
    }

    if (startIdx <= 1) {
      try {
        // created_at acota el reenvio: si el correo ya salio despues de encolarse
        // este job (reenvio manual de FICO, frontend viejo), no se manda de nuevo.
        const email = await sendMembershipEmail({ enrollmentId, skipIfSentAfter: job.created_at })
        result.email = { success: !!email?.success, messageId: email?.messageId, error: email?.error }
        if (!email?.success) {
          throw Object.assign(new Error(email?.error || 'Email membresia no enviado'), { _failStep: 'email' })
        }
        await updateCurrentStep(job.job_id, 'email')
      } catch (err) {
        if (!err._failStep) err._failStep = 'email'
        throw err
      }
    } else {
      result.skipped.push('email')
    }

    return result
  },

  /**
   * Activacion de membresia: abre los cursos del catalogo en Odoo. Corre en la
   * fecha que eligio el socio (next_attempt_at <= NOW()); si activo hoy, en el
   * proximo poll. La bienvenida ya salio por 'membership_welcome'.
   *
   * payload: { enrollmentId } — el resto se lee de la BD para evitar staleness.
   * current_step: null | 'odoo' (ultimo completado).
   */
  async membership_activation (job) {
    const { enrollment_id: enrollmentId, current_step: completed } = job
    if (completed === 'odoo') return { skipped: ['odoo'] }

    try {
      const odoo = await enrollMembershipInOdoo({ enrollmentId })
      if (!odoo?.success) {
        throw Object.assign(new Error(odoo?.error || 'Odoo membership enrollment fallo'), { _failStep: 'odoo' })
      }
      await updateCurrentStep(job.job_id, 'odoo')
      return { odoo }
    } catch (err) {
      if (!err._failStep) err._failStep = 'odoo'
      throw err
    }
  }
}

const POLL_SCHEDULE = '*/5 * * * * *' // cada 5 segundos
let _ticking = false

async function tick () {
  if (_ticking) return // evita overlap si un tick tarda > 5s
  _ticking = true
  try {
    const job = await claimNextJob()
    if (!job) return

    console.log(`[job-worker] claim job=${job.job_id} type=${job.job_type} enrollment=${job.enrollment_id} attempt=${job.attempts}/${job.max_attempts}`)
    const handler = handlers[job.job_type]
    if (!handler) {
      await failJob(job.job_id, {
        errorMsg: `Handler no registrado para job_type='${job.job_type}'`,
        attempts: job.max_attempts, // forzar failed inmediatamente
        maxAttempts: job.max_attempts
      })
      console.error(`[job-worker] job=${job.job_id} FAILED: handler '${job.job_type}' no existe`)
      return
    }

    const t0 = Date.now()
    try {
      const result = await handler(job)
      await completeJob(job.job_id, result)
      console.log(`[job-worker] job=${job.job_id} DONE en ${Date.now() - t0}ms`)
    } catch (err) {
      const step = err._failStep || job.current_step || null
      await failJob(job.job_id, {
        errorStep: step,
        errorMsg: err.message,
        attempts: job.attempts,
        maxAttempts: job.max_attempts
      })
      const willRetry = job.attempts < job.max_attempts
      console.error(`[job-worker] job=${job.job_id} ${willRetry ? 'RETRY' : 'FAILED'} en step=${step} tras ${Date.now() - t0}ms: ${err.message}`)
    }
  } catch (err) {
    console.error('[job-worker] tick error:', err.message)
  } finally {
    _ticking = false
  }
}

if (process.env.FICO_JOB_WORKER_DISABLED === 'true') {
  console.log('[job-worker] DESHABILITADO via FICO_JOB_WORKER_DISABLED=true')
} else {
  // Reap jobs colgados al startup (worker anterior crasheo)
  reapStaleJobs()
    .then(n => { if (n > 0) console.log(`[job-worker] startup: ${n} job(s) colgados reapeados a pending`) })
    .catch(err => console.error('[job-worker] reapStaleJobs fallo:', err.message))

  cron.schedule(POLL_SCHEDULE, tick, { timezone: 'America/Lima' })
  console.log('[job-worker] Programado (poll cada 5s, TZ America/Lima)')
}
