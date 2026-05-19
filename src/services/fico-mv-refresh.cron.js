// Refresh periodico de mv_enrollment_report_system.
//
// La MV reemplaza la vista pesada que usa el listado de FICO Inscripciones.
// Cada REFRESH CONCURRENTLY tarda ~4s y bloquea solo escrituras, no lecturas.
//
// Cadencia: cada 2 minutos. Razon: la vista cuesta ~4s; refrescarla cada 30s
// quemaria ~13% del tiempo de la BD. Cada 2 min queda en ~3.3% y mantiene
// los datos suficientemente frescos para vistas operativas.
//
// Para frescura instantanea post-inscripcion existe el refresh on-demand
// disparado desde ficoEnrollmentRegister (ver fico.service.js).
//
// Set FICO_MV_REFRESH_DISABLED=true para apagarlo (debug/migraciones).

import cron from 'node-cron'
import { pool } from '../config/db.js'

const REFRESH_SQL = 'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_enrollment_report_system'
const SCHEDULE = '*/2 * * * *' // every 2 minutes
let _running = false

async function refreshNow (source) {
  if (_running) {
    console.log(`[mv-refresh] (${source}) skip: otro refresh en curso`)
    return
  }
  _running = true
  const t0 = Date.now()
  try {
    await pool.query(REFRESH_SQL)
    console.log(`[mv-refresh] (${source}) OK en ${Date.now() - t0}ms`)
  } catch (err) {
    console.error(`[mv-refresh] (${source}) FALLO tras ${Date.now() - t0}ms:`, err.message)
  } finally {
    _running = false
  }
}

if (process.env.FICO_MV_REFRESH_DISABLED === 'true') {
  console.log('[mv-refresh] DESHABILITADO via FICO_MV_REFRESH_DISABLED=true')
} else {
  cron.schedule(SCHEDULE, () => refreshNow('cron'), { timezone: 'America/Lima' })
  console.log(`[mv-refresh] Programado cada 2 min (TZ America/Lima)`)
}

// Exportamos refreshNow para que fico.service.js pueda dispararlo on-demand
// despues de cambios que el usuario debe ver inmediatamente (nueva inscripcion,
// edicion de monto, etc.).
export { refreshNow as refreshEnrollmentMv }
