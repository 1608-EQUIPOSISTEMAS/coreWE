// Sondeo rapido de aliases de catalogo por prefijo.
//   node scripts/probe-catalog-aliases.mjs we_certificate we_method_payment
import { q, pool } from './db.mjs'

for (const prefijo of process.argv.slice(2)) {
  const { rows } = await q(
    `SELECT catalog_id, alias, description FROM public.catalog
      WHERE alias LIKE $1 ORDER BY catalog_id`,
    [`${prefijo}%`]
  )
  console.log(`\n=== ${prefijo} (${rows.length})`)
  console.table(rows)
}

await pool.end()
