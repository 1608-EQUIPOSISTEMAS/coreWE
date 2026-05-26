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
let _inflight = null   // promesa del refresh en curso (para poder esperarlo)

async function refreshNow (source) {
  // Si ya hay un refresh en curso, devolvemos su promesa para que quien quiera
  // pueda esperarlo, en vez de lanzar otro REFRESH CONCURRENTLY en paralelo.
  if (_running) {
    console.log(`[mv-refresh] (${source}) en curso: reutilizando refresh activo`)
    return _inflight
  }
  _running = true
  const t0 = Date.now()
  _inflight = (async () => {
    try {
      await pool.query(REFRESH_SQL)
      console.log(`[mv-refresh] (${source}) OK en ${Date.now() - t0}ms`)
    } catch (err) {
      console.error(`[mv-refresh] (${source}) FALLO tras ${Date.now() - t0}ms:`, err.message)
    } finally {
      _running = false
    }
  })()
  return _inflight
}

// Refresh forzado y ESPERABLE: garantiza que, al resolver, la MV refleja un
// estado posterior a la llamada. Si hay un refresh en vuelo (que pudo capturar
// su snapshot antes de los últimos cambios), lo espera y luego lanza uno nuevo.
// Lo usa el botón "Recargar" del listado FICO para ver todo fresco al instante.
async function forceRefreshNow (source = 'manual') {
  if (_running && _inflight) {
    try { await _inflight } catch { /* ignore */ }
  }
  return refreshNow(source)
}

if (process.env.FICO_MV_REFRESH_DISABLED === 'true') {
  console.log('[mv-refresh] DESHABILITADO via FICO_MV_REFRESH_DISABLED=true')
} else {
  cron.schedule(SCHEDULE, () => refreshNow('cron'), { timezone: 'America/Lima' })
  console.log(`[mv-refresh] Programado cada 2 min (TZ America/Lima)`)
}

// Exportamos refreshNow (fire-and-forget) para disparos on-demand tras cambios,
// y forceRefreshNow (esperable) para el botón "Recargar" del listado.
export { refreshNow as refreshEnrollmentMv, forceRefreshNow as forceRefreshEnrollmentMv }
