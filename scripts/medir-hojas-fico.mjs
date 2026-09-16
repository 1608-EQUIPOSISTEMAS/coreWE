// Cuanto tarda cada hoja FICO despues del fix de RP.
//
// La duda concreta: EXCLUDE_RP_ORIGIN mete un NOT EXISTS sobre RP_LINK_SQL y
// RP_ORIGIN_JOIN es un LATERAL que lo evalua otra vez, los dos por cada fila.
// RP_LINK_SQL recorre enrollment_audit_log (~500k filas, indice solo en la PK)
// tres veces unidas. Si Postgres no materializa ese subplan, el sync -- que
// corre en cron -- pasa de segundos a minutos.
//
// statement_timeout para que un plan patologico falle fuerte en vez de colgarse.
import { integrationRepository } from '../src/modules/integration/integration.repository.js'
import { pool } from '../src/config/db.js'

const HOJAS = [
  'getFicoSales', 'getFicoConvenios', 'getFicoAula',
  'getFicoEventos', 'getFicoConsolidado', 'getFicoCuotas'
]

const TIMEOUT_MS = 120000

const { rows: [{ db }] } = await pool.query('SELECT current_database() AS db')
console.log('BD:', db, `| statement_timeout ${TIMEOUT_MS / 1000}s\n`)
await pool.query(`SET statement_timeout = ${TIMEOUT_MS}`)

const medidas = []
for (const hoja of HOJAS) {
  const t0 = Date.now()
  try {
    const filas = await integrationRepository[hoja]()
    const ms = Date.now() - t0
    medidas.push({ hoja, ms, filas: filas.length, estado: ms > 30000 ? 'LENTA' : 'ok' })
    console.log(`${hoja.padEnd(22)} ${String(ms).padStart(7)} ms   ${filas.length} filas`)
  } catch (err) {
    const ms = Date.now() - t0
    medidas.push({ hoja, ms, filas: 0, estado: `ERROR: ${err.message}` })
    console.error(`${hoja.padEnd(22)} ${String(ms).padStart(7)} ms   FALLO: ${err.message}`)
  }
}

console.log('\n== RESUMEN ==')
console.table(medidas)

const total = medidas.reduce((s, m) => s + m.ms, 0)
console.log(`total: ${(total / 1000).toFixed(1)} s`)
const malas = medidas.filter((m) => m.estado !== 'ok')
console.log(malas.length ? `\nHOJAS CON PROBLEMA: ${malas.map((m) => m.hoja).join(', ')}` : '\nlas 6 hojas corren sin problema')

await pool.end()
