// Busca la empresa QROMA en el maestro de companies.
//   node scripts/probe-empresas-qroma.mjs [--prod]
import fs from 'fs'
if (process.argv.includes('--prod')) {
  process.env.DATABASE_URL = fs.readFileSync('.env.bak-produccion', 'utf8').match(/postgresql:\/\/\S+/)[0]
}
const { pool } = await import('./db.mjs')

const cols = await pool.query(`
  SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='companies' ORDER BY ordinal_position`)
console.log('companies:', cols.rows.map(c => c.column_name).join(', '))

const { rows } = await pool.query(
  "SELECT * FROM companies WHERE razon_social ILIKE '%QROMA%' ORDER BY razon_social")
console.log(`coincidencias con QROMA: ${rows.length}`)
console.table(rows)
await pool.end()
