// Sync automático de las hojas que antes se subían a mano desde el menú:
//   - PLANEAMIENTO: por cambios, misma lógica que el sync FICO
//     (fico-sheets-autosync.cron.js): mira cada minuto el contador que suben los
//     triggers de scripts/planeamiento-sheet-autosync.sql, espera 1 min de calma
//     (tope 5 min) y nunca corre más de una vez cada 3 min.
//   - Prospectos ("3. SYSTEM"): por horario, 10:00 y 18:30 hora Lima.
//
// Mismo interruptor que el sync FICO: FICO_SHEETS_AUTOSYNC_ENABLED=true SOLO en
// el .env de producción. Los IDs de los Sheets están fijos: un backend local con
// el clon pisaría los Sheets reales.

import cron from 'node-cron'
import { planeamientoAutosyncTick, syncRprospectos } from '../modules/integration/integration.usecases.js'

const TZ = 'America/Lima'
let _ticking = false
let _state = { version: null, changedAt: null, pendingSince: null, syncedVersion: -1, lastRunAt: null, lastOkAt: null }

async function planeamientoTick () {
  if (_ticking) return
  _ticking = true
  try {
    _state = await planeamientoAutosyncTick(_state)
  } catch (err) {
    console.error('[planeamiento-autosync] vuelta fallida:', err.message)
  } finally {
    _ticking = false
  }
}

async function prospectosRun () {
  try {
    const r = await syncRprospectos()
    console.log(`[prospectos-sync] ${r.rows_generated} filas`)
  } catch (err) {
    console.error('[prospectos-sync] fallido:', err.message)
  }
}

if (process.env.FICO_SHEETS_AUTOSYNC_ENABLED !== 'true') {
  console.log('[sheets-autosync] apagado (FICO_SHEETS_AUTOSYNC_ENABLED no es true)')
} else {
  cron.schedule('* * * * *', planeamientoTick, { timezone: TZ })
  cron.schedule('0 10 * * *', prospectosRun, { timezone: TZ })
  cron.schedule('30 18 * * *', prospectosRun, { timezone: TZ })
  console.log('[sheets-autosync] Planeamiento por cambios; Prospectos 10:00 y 18:30 (TZ America/Lima)')
}
