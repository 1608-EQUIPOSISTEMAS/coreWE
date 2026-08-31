// Corre la query de la hoja "7. Convenios" y muestra las filas tal como se
// escribirian en el Sheet. One-off de verificacion.
//   node scripts/probe-convenios-hoja.mjs [--prod]
import fs from 'fs'

// --prod apunta al tunel SSH leyendo la URL del respaldo. Se toca DATABASE_URL,
// nunca PGPASSWORD: PGPASSWORD gana sobre el .env y parte los pools en dos BD.
if (process.argv.includes('--prod')) {
  process.env.DATABASE_URL = fs.readFileSync('.env.bak-produccion', 'utf8').match(/postgresql:\/\/\S+/)[0]
}
const { pool } = await import('./db.mjs')
const { IntegrationRepository } = await import('../src/modules/integration/integration.repository.js')
const { buildConveniosRow, CONVENIOS_HEADER_ROW } = await import('../src/modules/integration/integration.entity.js')

const rows = await new IntegrationRepository(pool).getFicoConvenios()
console.log('filas:', rows.length)
console.log(CONVENIOS_HEADER_ROW.join(' | '))
for (const r of rows) console.log(buildConveniosRow(r).map(v => v === '' ? '·' : v).join(' | '))
await pool.end()
