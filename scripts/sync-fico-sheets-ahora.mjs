// Dispara el sync FICO -> Google Sheets desde esta maquina, con el codigo local,
// sin esperar al boton del panel. Sirve cuando se libero algo del filtro en
// codigo y hay que verlo en las hojas antes del redeploy.
//
// OJO: la siguiente corrida del backend desplegado reescribe las hojas con SU
// codigo; si el cambio no esta desplegado, lo deshace.
//
// Hojas UNA POR UNA, no el Promise.all de syncFicoToSheets: las 9 en paralelo
// agotaron la RAM de esta maquina y Windows mato el proceso entre el clear y el
// update de ensureAndWrite, que es justo el hueco donde una hoja queda vacia.
//
// Uso (desde Backend/, credentials/service.json se resuelve contra cwd):
//   node scripts/sync-fico-sheets-ahora.mjs              # las 9
//   node scripts/sync-fico-sheets-ahora.mjs Sales Aula   # solo esas (por nombre de funcion)
import { pool } from '../src/shared/db/pool.js'
import {
  syncFicoSalesToSheet, syncFicoAulaToSheet, syncFicoConsolidadoToSheet,
  syncFicoCuotasToSheet, syncFicoEventosToSheet, syncFicoCronogramaToSheet,
  syncFicoAdicionalesToSheet, syncFicoMembresiasToSheet, syncFicoConveniosToSheet
} from '../src/modules/integration/integration.usecases.js'

console.log('BD:', (await pool.query('SELECT current_database() AS db')).rows[0].db)

const HOJAS = [
  syncFicoSalesToSheet, syncFicoAulaToSheet, syncFicoConsolidadoToSheet,
  syncFicoCuotasToSheet, syncFicoEventosToSheet, syncFicoCronogramaToSheet,
  syncFicoAdicionalesToSheet, syncFicoMembresiasToSheet, syncFicoConveniosToSheet
]
const pedidas = process.argv.slice(2)
const elegidas = pedidas.length
  ? HOJAS.filter(f => pedidas.some(p => f.name === `syncFico${p}ToSheet`))
  : HOJAS
for (const sync of elegidas) {
  const r = await sync()
  console.log(`${r.sheet ?? sync.name}: ${r.rows_synced} filas`)
}
await pool.end()
