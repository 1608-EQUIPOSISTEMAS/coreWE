import { syncPool } from '../../shared/db/pool.js'

// Clave del advisory lock: la comparten el botón y el automático, así nunca
// corren dos syncs a la vez, ni entre procesos ni entre servidores.
const LOCK_KEY = "hashtext('fico_sheets_sync')"

export class FicoAutosyncRepository {
  constructor (db = syncPool) {
    this.db = db
  }

  // Corre fn solo si consigue el lock; si otro sync lo tiene, devuelve null sin
  // esperar. El lock es de sesión: si la conexión muere (timeout, caída) Postgres
  // lo suelta solo, así que nunca queda trabado como el booleano en memoria.
  async withLock (fn) {
    const client = await this.db.connect()
    let broken = false
    try {
      const { rows: [{ ok }] } = await client.query(`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS ok`)
      if (!ok) return null
      try {
        return await fn()
      } finally {
        await client.query(`SELECT pg_advisory_unlock(${LOCK_KEY})`).catch((err) => {
          // Sin unlock la conexión se descarta: cerrarla suelta el lock igual.
          broken = true
          console.error('[fico-autosync] no se pudo soltar el lock:', err.message)
        })
      }
    } finally {
      client.release(broken)
    }
  }

  // ¿Hay un sync corriendo ahora? Lo dice el lock, no la tabla: una fila
  // 'running' puede ser de un proceso que murió a mitad.
  async isRunning () {
    const free = await this.withLock(async () => true)
    return free === null
  }

  // Valor actual del contador de cambios (0 si nunca se movió).
  async changeVersion () {
    const { rows: [r] } = await this.db.query(
      'SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS v FROM public.fico_sheets_change_seq')
    return Number(r.v)
  }

  async lastRuns () {
    const { rows: [r] } = await this.db.query(`
      SELECT (SELECT row_to_json(x) FROM (
                SELECT run_id, trigger, status, started_at, finished_at, error, rows_by_sheet
                  FROM public.fico_sheet_sync_runs ORDER BY run_id DESC LIMIT 1) x) AS last,
             (SELECT row_to_json(x) FROM (
                SELECT run_id, watermark, finished_at
                  FROM public.fico_sheet_sync_runs WHERE status = 'ok'
                 ORDER BY run_id DESC LIMIT 1) x) AS last_ok`)
    return r
  }

  async startRun ({ trigger, watermark, requestedBy = null }) {
    const { rows: [r] } = await this.db.query(`
      INSERT INTO public.fico_sheet_sync_runs (trigger, watermark, requested_by)
      VALUES ($1, $2, $3) RETURNING run_id`, [trigger, watermark, requestedBy])
    return r.run_id
  }

  async finishRun (runId, { status, rowsBySheet = null, error = null }) {
    await this.db.query(`
      UPDATE public.fico_sheet_sync_runs
         SET status = $2, finished_at = now(), rows_by_sheet = $3, error = $4
       WHERE run_id = $1`, [runId, status, rowsBySheet, error])
  }

  // Una corrida que quedó 'running' porque el proceso murió a mitad. Solo se
  // llama con el lock tomado, así que ninguna de esas sigue viva de verdad.
  async closeOrphanRuns () {
    await this.db.query(`
      UPDATE public.fico_sheet_sync_runs
         SET status = 'failed', finished_at = now(), error = 'Interrumpida (reinicio del servidor)'
       WHERE status = 'running'`)
  }

  // Fallas seguidas desde la última corrida exitosa.
  async consecutiveFailures () {
    const { rows: [r] } = await this.db.query(`
      SELECT count(*)::int AS n FROM public.fico_sheet_sync_runs
       WHERE status = 'failed'
         AND run_id > COALESCE((SELECT max(run_id) FROM public.fico_sheet_sync_runs WHERE status = 'ok'), 0)`)
    return r.n
  }
}

export const ficoAutosyncRepository = new FicoAutosyncRepository()
