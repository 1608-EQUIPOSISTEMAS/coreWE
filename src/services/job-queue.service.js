// Cola asincrona basada en Postgres (sin Redis).
//
// Patron: fico_jobs es la tabla, el worker (ver job-worker.cron.js) la polea
// cada 5 segundos con `SELECT ... FOR UPDATE SKIP LOCKED` — eso garantiza que
// aunque haya N workers, cada job lo procese solo uno.
//
// IMPORTANTE: claimNextJob abre y cierra su propia tx CORTA. El handler corre
// fuera de transaccion (no queremos bloquear conexiones del pool por los ~5s
// que tarda Odoo o el email). completeJob/failJob hacen sus propios UPDATE
// independientes — son atomicos en si mismos.
//
// Backoff: 2^attempts * 30s, capped a 5 min. Tras max_attempts queda 'failed'
// para revision manual.

import { pool } from '../config/db.js'

const BACKOFF_BASE_SECONDS = 30
const BACKOFF_MAX_SECONDS = 300

function nextBackoffSeconds (attempts) {
  const exp = Math.min(attempts, 10)
  return Math.min(BACKOFF_BASE_SECONDS * Math.pow(2, exp), BACKOFF_MAX_SECONDS)
}

// runAt: si se pasa, el job no sera reclamable hasta esa fecha/hora. Se traduce
// a next_attempt_at en el INSERT. Sin runAt = NOW() (comportamiento default de
// la columna). Acepta Date o string ISO.
export async function enqueue ({ jobType, enrollmentId = null, payload = {}, maxAttempts = 5, runAt = null }) {
  if (!jobType || typeof jobType !== 'string') {
    throw new Error('enqueue: jobType requerido')
  }
  if (runAt != null) {
    const runAtIso = runAt instanceof Date ? runAt.toISOString() : String(runAt)
    const { rows } = await pool.query(
      `INSERT INTO public.fico_jobs (job_type, enrollment_id, payload, max_attempts, next_attempt_at)
       VALUES ($1, $2, $3::jsonb, $4, $5::timestamptz)
       RETURNING job_id, status, next_attempt_at, created_at`,
      [jobType, enrollmentId, JSON.stringify(payload), maxAttempts, runAtIso]
    )
    return rows[0]
  }
  const { rows } = await pool.query(
    `INSERT INTO public.fico_jobs (job_type, enrollment_id, payload, max_attempts)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING job_id, status, created_at`,
    [jobType, enrollmentId, JSON.stringify(payload), maxAttempts]
  )
  return rows[0]
}

// Re-agenda un job pendiente cambiando su next_attempt_at. Usado por el endpoint
// PATCH de reprogramacion de membresia: si FICO mueve la fecha de activacion,
// movemos tambien el job ya encolado en vez de crear uno nuevo (evita duplicados).
// Solo afecta jobs en estado 'pending' — si ya esta in_progress/done/failed no se
// toca y retorna 0.
export async function rescheduleJob ({ jobId, runAt }) {
  if (!jobId) throw new Error('rescheduleJob: jobId requerido')
  if (runAt == null) throw new Error('rescheduleJob: runAt requerido')
  const runAtIso = runAt instanceof Date ? runAt.toISOString() : String(runAt)
  const { rowCount } = await pool.query(`
    UPDATE public.fico_jobs
    SET next_attempt_at = $2::timestamptz
    WHERE job_id = $1 AND status = 'pending'
  `, [jobId, runAtIso])
  return rowCount
}

// Reclama el siguiente job pendiente (mas viejo primero) y lo marca como
// in_progress. La tx es corta — el handler corre FUERA. Si el proceso del
// worker crashea despues del claim, el job queda 'in_progress' colgado
// (ver reapStaleJobs).
export async function claimNextJob () {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`
      SELECT job_id, job_type, enrollment_id, payload, attempts, max_attempts, current_step, created_at
      FROM public.fico_jobs
      WHERE status = 'pending' AND next_attempt_at <= NOW()
      ORDER BY next_attempt_at ASC, job_id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `)
    if (rows.length === 0) {
      await client.query('COMMIT')
      return null
    }
    const job = rows[0]
    await client.query(`
      UPDATE public.fico_jobs
      SET status = 'in_progress', started_at = NOW(), attempts = attempts + 1
      WHERE job_id = $1
    `, [job.job_id])
    await client.query('COMMIT')
    return { ...job, attempts: job.attempts + 1 }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export async function completeJob (jobId, result = null) {
  await pool.query(`
    UPDATE public.fico_jobs
    SET status = 'done', finished_at = NOW(), result = $2::jsonb,
        error_message = NULL, error_step = NULL
    WHERE job_id = $1
  `, [jobId, result ? JSON.stringify(result) : null])
}

// Llamar durante el handler para marcar progreso multi-step (children -> odoo -> email).
// Si el handler crashea, sabemos en que step estabamos al reintentar.
export async function updateCurrentStep (jobId, step) {
  await pool.query(`
    UPDATE public.fico_jobs SET current_step = $2 WHERE job_id = $1
  `, [jobId, step])
}

// Si attempts < max: reagenda con backoff. Si >= max: marca 'failed' para revision.
export async function failJob (jobId, { errorStep = null, errorMsg, attempts, maxAttempts }) {
  const exhausted = attempts >= maxAttempts
  if (exhausted) {
    await pool.query(`
      UPDATE public.fico_jobs
      SET status = 'failed', finished_at = NOW(), error_message = $2, error_step = $3
      WHERE job_id = $1
    `, [jobId, errorMsg, errorStep])
  } else {
    const seconds = nextBackoffSeconds(attempts)
    await pool.query(`
      UPDATE public.fico_jobs
      SET status = 'pending',
          next_attempt_at = NOW() + ($1 || ' seconds')::interval,
          error_message = $2,
          error_step = $3,
          started_at = NULL
      WHERE job_id = $4
    `, [String(seconds), errorMsg, errorStep, jobId])
  }
}

// Reset de jobs en 'in_progress' colgados (worker crasheo entre claim y complete).
// Llamar al startup del worker. Treshold: 10 min — si un job lleva mas que eso
// in_progress y no termino, asumimos que el worker murio.
export async function reapStaleJobs () {
  const { rowCount } = await pool.query(`
    UPDATE public.fico_jobs
    SET status = 'pending', started_at = NULL,
        error_message = COALESCE(error_message, 'Reaped: worker died durante el job')
    WHERE status = 'in_progress' AND started_at < NOW() - INTERVAL '10 minutes'
  `)
  return rowCount
}

// Devuelve el job mas reciente para una inscripcion. Si jobType se especifica,
// filtra por ese tipo. El frontend polea esto para mostrar progreso.
export async function getLatestJobByEnrollment (enrollmentId, jobType = null) {
  const params = [enrollmentId]
  let where = 'enrollment_id = $1'
  if (jobType) {
    params.push(jobType)
    where += ` AND job_type = $${params.length}`
  }
  const { rows } = await pool.query(`
    SELECT job_id, job_type, status, current_step, attempts, max_attempts,
           created_at, started_at, finished_at, next_attempt_at,
           error_message, error_step, result
    FROM public.fico_jobs
    WHERE ${where}
    ORDER BY job_id DESC
    LIMIT 1
  `, params)
  return rows[0] || null
}
