// Aviso diario de becas a Fundacion (ver fundacion-becas.usecases.sendAlertsDigest).
//
// 8:00 Lima de lunes a viernes: llega antes de que el equipo empiece. Si ese
// dia no hay pendientes viejas ni becas por vencer, no sale correo.
//
// APAGADO por defecto: se enciende con FUNDACION_BECAS_ALERTS_ENABLED=true
// (solo en produccion). Asi un backend local no le manda correos a Fundacion.
// ponytail: sin lock entre procesos; con dos backends encendidos saldrian dos
// correos. Agregar pg_try_advisory_lock (como daily-plan) si eso pasa.

import cron from 'node-cron'
import { sendAlertsDigest } from '../modules/fundacion-becas/fundacion-becas.usecases.js'

const SCHEDULE = '0 8 * * 1-5'

async function run () {
  try {
    const r = await sendAlertsDigest()
    console.log(`[becas-alerts] ${r.sent ? `enviado (${r.total} aviso(s))` : `no enviado: ${r.reason}`}`)
  } catch (err) {
    console.error('[becas-alerts] FALLO:', err.message)
  }
}

if (process.env.FUNDACION_BECAS_ALERTS_ENABLED === 'true') {
  cron.schedule(SCHEDULE, run, { timezone: 'America/Lima' })
  console.log(`[becas-alerts] Programado '${SCHEDULE}' (TZ America/Lima)`)
} else {
  console.log('[becas-alerts] apagado (FUNDACION_BECAS_ALERTS_ENABLED != true)')
}
