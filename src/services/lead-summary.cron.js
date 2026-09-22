// Resumen IA de leads: pre-calentado nocturno. Ver modules/comercial/lead-summary.
//
// 5:45 (Lima) de lunes a sabado, antes del plan del dia (6:30): deja listos los
// resumenes de los leads que se movieron ayer, que son los que el asesor va a
// abrir hoy. El resto se genera al abrir la ficha.
//
// APAGADO por defecto, igual que el plan del dia: AI_LEAD_SUMMARY=true y AI_LEAD_SUMMARY_PREWARM=true
// solo en produccion. Tope por noche: AI_LEAD_SUMMARY_PREWARM_LIMIT (40 = ~15 min).

import cron from 'node-cron'
import { prewarmLeadSummaries } from '../modules/comercial/lead-summary/lead-summary.usecases.js'

const SCHEDULE = '45 5 * * 1-6'
const TZ = 'America/Lima'

if (process.env.AI_LEAD_SUMMARY === 'true' && process.env.AI_LEAD_SUMMARY_PREWARM === 'true') {
  const limit = Number(process.env.AI_LEAD_SUMMARY_PREWARM_LIMIT) || 40
  cron.schedule(SCHEDULE, () => {
    prewarmLeadSummaries({ limit }).catch(err => console.error('[lead-summary] prewarm fallo:', err.message))
  }, { timezone: TZ })
  console.log(`[lead-summary] prewarm programado '${SCHEDULE}' (TZ ${TZ}), tope ${limit}`)
}
