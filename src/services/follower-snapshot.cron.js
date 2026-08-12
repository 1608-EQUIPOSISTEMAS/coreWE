// Snapshot de seguidores de las cuentas de RRSS (tabla social_follower_snapshots).
//
// Corre DIARIO y siempre escribe sobre la fila de la semana ISO en curso, aunque
// el reporte sea semanal. Un cron semanal pierde la semana entera si el server
// está caído ese lunes; escribiendo a diario sobre la misma fila el valor
// converge al del cierre de semana —la semántica que tenía la columna
// "Seguidores" de la hoja— y un día caído se auto-repara al siguiente.
//
// Credenciales por .env; si faltan, esa red se salta y se sigue cargando a mano
// (ver buildFollowerProviders en config/socialFollowersClient.js):
//   IG_ACCESS_TOKEN   -> Instagram
//   FB_PAGE_TOKEN     -> Facebook (páginas; los grupos no tienen API)
//   YOUTUBE_API_KEY   -> YouTube
//
// La captura en sí vive en follower-snapshot.js, que se puede importar sin
// programar nada. Set SOCIAL_SNAPSHOT_DISABLED=true para apagar el cron.

import cron from 'node-cron'
import { snapshotFollowersNow } from './follower-snapshot.js'

const SCHEDULE = '0 6 * * *'

if (process.env.SOCIAL_SNAPSHOT_DISABLED === 'true') {
  console.log('[follower-snapshot] DESHABILITADO via SOCIAL_SNAPSHOT_DISABLED=true')
} else {
  cron.schedule(SCHEDULE, () => snapshotFollowersNow('cron'), { timezone: 'America/Lima' })
  console.log('[follower-snapshot] Programado diario 06:00 (TZ America/Lima)')
}
