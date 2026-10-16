// Predictividad Comercial: mantiene fresca la historia (ficha del cliente) y
// arma la bandeja "Llamar hoy" antes de que llegue el equipo.
//
// - Cada 30 min: REFRESH CONCURRENTLY de mv_commercial_history (~6 s, no
//   bloquea lecturas). Una consulta de hoy tiene que verse en la ficha hoy.
// - 6:00 Lima, lunes a sabado: refresca y genera la bandeja (cierra lo que
//   compro o vencio y reparte clientes nuevos). El refresh va primero: sin el,
//   la bandeja no sabria quien compro ayer.
//
// APAGADO por defecto: PREDICCION_CRON_ENABLED=true cuando existan en esa BD la
// matview y pred_call_assignments (scripts/pred-0b-*.sql y pred-2-bandeja.sql).
// Sin ellas solo llenaria el log de errores.

import cron from 'node-cron'
import { pool } from '../config/db.js'
import { generarBandeja } from '../modules/prediccion/bandeja.usecases.js'

const TZ = 'America/Lima'
const REFRESH_SQL = 'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_commercial_history'
let refreshing = null

// Si ya hay un refresh en curso, se espera ese en vez de lanzar otro.
function refreshHistory (source) {
  refreshing ??= (async () => {
    const t0 = Date.now()
    try {
      await pool.query(REFRESH_SQL)
      console.log(`[prediccion] (${source}) refresh OK en ${Date.now() - t0}ms`)
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

async function morningQueue () {
  try {
    await refreshHistory('bandeja')
    console.log('[prediccion] bandeja generada', await generarBandeja())
  } catch (err) {
    console.error('[prediccion] bandeja FALLO:', err.message)
  }
}

if (process.env.PREDICCION_CRON_ENABLED === 'true') {
  cron.schedule('*/30 * * * *', () => refreshHistory('cron').catch((err) =>
    console.error('[prediccion] refresh FALLO:', err.message)), { timezone: TZ })
  cron.schedule('0 6 * * 1-6', morningQueue, { timezone: TZ })
  console.log('[prediccion] refresh cada 30 min y bandeja 6:00 (Lima)')
}
