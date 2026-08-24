// Corre un .sql contra la BD elegida y muestra lo que devuelve.
// El .env apunta a pruebas; para produccion hay que pasar PROD_URL a proposito.
//   node scripts/apply-sql.mjs scripts/enable-ponente-v-congreso.sql
//   PROD_URL=postgresql://... node scripts/apply-sql.mjs scripts/x.sql
import { readFileSync } from 'node:fs'
import pg from 'pg'

const archivo = process.argv[2]
if (!archivo) { console.error('Falta la ruta del .sql'); process.exit(1) }

const destino = process.env.PROD_URL ? 'PRODUCCION' : 'PRUEBAS'
const cliente = new pg.Client({
  connectionString: process.env.PROD_URL || 'postgresql://postgres:postgres@127.0.0.1:5433/system_erp_dev',
  ssl: false
})
await cliente.connect()
console.log(`Aplicando ${archivo} en ${destino}...`)
const resultado = await cliente.query(readFileSync(archivo, 'utf8'))
for (const r of [].concat(resultado)) {
  console.log(`${r.command} ${r.rowCount ?? ''}`)
  if (r.rows?.length) console.table(r.rows)
}
await cliente.end()
