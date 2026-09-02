import { q, pool } from './db.mjs'
const { rows } = await q(`
  SELECT p.alias AS grupo, c.catalog_id, c.alias, c.description
  FROM catalog c JOIN catalog p ON p.catalog_id = c.catalog_parent_id
  WHERE p.alias IN ('we_attempt','we_calling') AND c.active = 'Y'
  ORDER BY p.alias, c.catalog_id`)
console.table(rows)
await pool.end()
