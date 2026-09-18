// Reparto automatico diferido de tickets.
//
// Un ticket nace ABIERTO y SIN asignar a proposito (ver tickets.usecases
// createTicket): la idea es darle a un admin una ventana de gracia de
// AUTOASSIGN_ESPERA_MINUTOS (2 a 3 min, ver env) para tomarlo a mano desde
// "Reasignar a" antes de que el reparto automatico decida por el.
//
// Cadencia: cada minuto. A diferencia del barrido de SLA (cada 5 min, porque
// el plazo mas corto es de 1 hora), aca la ventana de gracia se mide en
// minutos, asi que necesita resolucion fina.
//
// TICKETS_AUTOASSIGN_DISABLED=true   apaga este cron.
// TICKETS_AUTOASSIGN_MINUTOS=3       ventana de gracia (default 3).
//
// Mismo cuidado que tickets-sla.cron.js: si algun dia corren varias instancias
// del backend, apagarlo en todas menos una.

import cron from 'node-cron'
import { runAutoAssignSweep } from '../modules/tickets/tickets.usecases.js'

const SCHEDULE = '* * * * *'
let _running = false

async function sweep () {
  if (_running) return
  _running = true
  const t0 = Date.now()
  try {
    const asignados = await runAutoAssignSweep()
    if (asignados) console.log(`[tickets-autoassign] ${asignados} ticket(s) asignado(s) tras la ventana de gracia`)
  } catch (err) {
    console.error(`[tickets-autoassign] FALLO tras ${Date.now() - t0}ms:`, err.message)
  } finally {
    _running = false
  }
}

if (process.env.TICKETS_AUTOASSIGN_DISABLED === 'true') {
  console.log('[tickets-autoassign] DESHABILITADO via TICKETS_AUTOASSIGN_DISABLED=true')
} else {
  cron.schedule(SCHEDULE, sweep, { timezone: 'America/Lima' })
  console.log('[tickets-autoassign] Programado cada minuto (TZ America/Lima)')
}

export { sweep as runTicketsAutoAssignSweep }
