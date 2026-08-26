// ponytail: sondeo one-off del catalogo de dias para el PDF de cronograma.
import { pool } from './db.mjs'
const { rows } = await pool.query(`
  SELECT c.catalog_id, c.alias, c.description, c.variable_1, c.variable_2, c.active
  FROM catalog c JOIN catalog p ON p.catalog_id = c.catalog_parent_id
  WHERE p.alias = 'we_day_combination' ORDER BY c.catalog_id
`)
console.table(rows)
await pool.end()
