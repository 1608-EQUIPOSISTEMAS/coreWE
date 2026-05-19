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
import ficoService from './fico.service.js'

// Steps del job 'register_followup' en orden topologico de dependencias.
// children DEBE correr primero (puede mutar program_edition_id a NULL si E0).
// odoo DEBE correr antes de email (email lee odoo_user_id).
const REGISTER_FOLLOWUP_STEPS = ['children', 'odoo', 'email']

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

    const startIdx = completed ? REGISTER_FOLLOWUP_STEPS.indexOf(completed) + 1 : 0
    const result = { skipped: [] }

    if (startIdx <= 0) {
      try {
        await ficoService.createChildEnrollments({ enrollmentId, userId })
        await updateCurrentStep(job.job_id, 'children')
      } catch (err) {
        throw Object.assign(err, { _failStep: 'children' })
      }
    } else {
      result.skipped.push('children')
    }

    if (startIdx <= 1) {
      try {
        const odoo = await ficoService.enrollInOdoo({ enrollmentId })
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
        const email = await ficoService.sendConfirmationEmail({ enrollmentId, cc })
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
