// Sincronizacion diaria de las reuniones de Teams por sesion (06:00 Lima):
// crea las que entran en la ventana de MS_TEAMS_HORIZON_DAYS, mueve las
// reprogramadas y cancela las de aulas retiradas.
//
// Opt-in con MS_TEAMS_SYNC_CRON=true: la primera corrida masiva se lanza a
// mano desde la pantalla (o /api/edition/teams/syncstart) tras validar con
// dry_run, no sola el dia que se cargan las credenciales.

import cron from 'node-cron'
import { startTeamsSync, teamsConfig } from '../modules/edition/teams-meetings.usecases.js'

if (process.env.MS_TEAMS_SYNC_CRON === 'true') {
  cron.schedule('0 6 * * *', () => {
    if (!teamsConfig().configured) {
      console.warn('[teams-cron] omitido: faltan credenciales MS_* en el .env')
      return
    }
    const job = startTeamsSync()
    console.log(`[teams-cron] sincronizacion iniciada job=${job.job_id}`)
  }, { timezone: 'America/Lima' })
  console.log('[teams-cron] Programado (diario 06:00, TZ America/Lima)')
}
