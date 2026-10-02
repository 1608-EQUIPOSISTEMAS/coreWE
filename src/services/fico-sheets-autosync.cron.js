// Sync automático FICO → Google Sheets.
//
// Cada minuto mira un contador que suben los triggers de las tablas de FICO
// (scripts/fico-sheets-autosync.sql). Mirar cuesta ~1 ms; el sync de verdad
// (~7 s) solo corre cuando hubo cambios, y además:
//   - espera 1 min sin cambios para juntar una ráfaga en una sola corrida,
//     con tope de 5 min si FICO no para de editar;
//   - nunca más de una corrida cada 3 min;
//   - una corrida de seguridad por hora en horario de oficina (7–22 h Lima).
// Las reglas están en modules/integration/fico-autosync.entity.js (con tests).
//
// Seguro con varias instancias del backend: la corrida toma un advisory lock en
// la BD, compartido con el endpoint manual; la que no lo consigue no hace nada.
//
// Apagado por defecto: solo corre con FICO_SHEETS_AUTOSYNC_ENABLED=true, que va
// SOLO en el .env de producción. Los IDs de los Sheets están fijos en el código:
// un backend local con el clon pisaría el Sheet real de FICO con datos viejos.

import cron from 'node-cron'
import { ficoAutosyncTick } from '../modules/integration/integration.usecases.js'

const SCHEDULE = '* * * * *'
let _ticking = false
let _state = { version: null, changedAt: null, pendingSince: null }

async function tick () {
  if (_ticking) return
  _ticking = true
  try {
    _state = await ficoAutosyncTick(_state)
  } catch (err) {
    // Una vuelta fallida (BD caída un momento) no tumba el proceso: reintenta al minuto.
    console.error('[fico-sheets-autosync] vuelta fallida:', err.message)
  } finally {
    _ticking = false
  }
}

if (process.env.FICO_SHEETS_AUTOSYNC_ENABLED !== 'true') {
  console.log('[fico-sheets-autosync] apagado (FICO_SHEETS_AUTOSYNC_ENABLED no es true)')
} else {
  cron.schedule(SCHEDULE, tick, { timezone: 'America/Lima' })
  console.log('[fico-sheets-autosync] Vigilando cambios cada minuto (TZ America/Lima)')
}

export { tick as runFicoSheetsAutosyncTick }
