// Barrido del SLA de tickets.
//
// Dos trabajos, ambos en tickets.usecases.runSlaSweep:
//
//   1. Escalamiento automatico: un ticket ABIERTO que nadie tomo y cuya primera
//      respuesta esta por vencer o vencio se reasigna a otro agente. UNA sola
//      vez por ticket (escalated_at es el guard): si el segundo tampoco lo toma,
//      rotarlo indefinidamente no lo resuelve y solo genera ruido.
//
//   2. Alertas de incumplimiento a Slack: un aviso por ticket y por reloj. El
//      sello se escribe SOLO si Slack confirmo, asi que un webhook caido deja el
//      aviso pendiente para la proxima corrida en vez de darlo por enviado.
//
// Cadencia: cada 5 minutos. El plazo mas corto configurable es de 1 hora
// (ALTA), asi que 5 minutos da resolucion de sobra sin castigar la BD; las tres
// consultas del barrido van por indices parciales sobre lo que puede cambiar.
//
// TICKETS_SLA_DISABLED=true   apaga el cron entero.
// TICKETS_SLA_ESCALATION=false apaga solo el escalamiento (las alertas siguen).
//
// Si algun dia corren varias instancias del backend, apagarlo en todas menos
// una: el barrido no esta coordinado entre procesos y cada una mandaria su
// propio aviso.

import cron from 'node-cron'
import { runSlaSweep } from '../modules/tickets/tickets.usecases.js'

const SCHEDULE = '*/5 * * * *'
let _running = false

async function sweep () {
  // Una corrida lenta no dispara una segunda encima: escalar dos veces el mismo
  // ticket lo tiene bloqueado escalated_at, pero mejor no pagar el doble trabajo.
  if (_running) return
  _running = true
  const t0 = Date.now()
  try {
    const { escalados, alertas } = await runSlaSweep()
    if (escalados) console.log(`[tickets-sla] ${escalados} ticket(s) reasignado(s) por escalamiento`)
    if (alertas) console.log(`[tickets-sla] ${alertas} aviso(s) de incumplimiento enviados`)
  } catch (err) {
    // Un fallo del barrido nunca tumba el proceso: el ERP sigue sirviendo.
    console.error(`[tickets-sla] FALLO tras ${Date.now() - t0}ms:`, err.message)
  } finally {
    _running = false
  }
}

if (process.env.TICKETS_SLA_DISABLED === 'true') {
  console.log('[tickets-sla] DESHABILITADO via TICKETS_SLA_DISABLED=true')
} else {
  cron.schedule(SCHEDULE, sweep, { timezone: 'America/Lima' })
  console.log('[tickets-sla] Programado cada 5 min (TZ America/Lima)')
}

// Exportado para poder dispararlo a mano desde un script de diagnostico.
export { sweep as runTicketsSlaSweep }
