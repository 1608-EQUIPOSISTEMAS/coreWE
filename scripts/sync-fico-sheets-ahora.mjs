// Dispara el sync FICO -> Google Sheets desde esta maquina, con el codigo local,
// sin esperar al boton del panel. Sirve cuando se libero algo del filtro en
// codigo y hay que verlo en las hojas antes del redeploy.
//
// OJO: la siguiente corrida del backend desplegado reescribe las hojas con SU
// codigo; si el cambio no esta desplegado, lo deshace.
//
// Uso (desde Backend/, credentials/service.json se resuelve contra cwd):
//   node scripts/sync-fico-sheets-ahora.mjs [correo ...]   # sin --aplicar solo muestra
//   node scripts/sync-fico-sheets-ahora.mjs [correo ...] --aplicar
import { pool } from '../src/shared/db/pool.js'
import { integrationRepository as repo } from '../src/modules/integration/integration.repository.js'
import { syncFicoToSheets } from '../src/modules/integration/integration.usecases.js'

const correos = process.argv.slice(2).filter(a => !a.startsWith('--')).map(c => c.toLowerCase())
const HOJAS = ['getFicoSales', 'getFicoAula', 'getFicoConsolidado', 'getFicoCuotas', 'getFicoConvenios']

console.log('BD:', (await pool.query('SELECT current_database() AS db')).rows[0].db)

for (const hoja of HOJAS) {
  const filas = await repo[hoja]()
  const presentes = correos.map(c => [c, filas.filter(f => String(f.correo ?? '').toLowerCase() === c).length])
  console.log(hoja.padEnd(20), 'filas', String(filas.length).padStart(5), '|', presentes.map(([c, n]) => `${c.split('@')[0]}=${n}`).join(' '))
}

if (process.argv.includes('--aplicar')) {
  const r = await syncFicoToSheets()
  console.log('sync ok:', Object.entries(r).map(([k, v]) => `${k}=${v.rows_synced}`).join(' '))
} else {
  console.log('\n(dry-run) volver a correr con --aplicar')
}
await pool.end()
