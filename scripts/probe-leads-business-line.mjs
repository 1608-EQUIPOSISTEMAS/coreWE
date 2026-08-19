// Reparto real de leads.cat_business_line. Define si /comercial/leads puede
// filtrar por linea de negocio sin perder los leads historicos (sin linea).
import { pool } from './db.mjs'

const { rows: cat } = await pool.query(`
  SELECT catalog_id, alias, description, active FROM catalog
   WHERE alias LIKE 'we_business_line%' ORDER BY catalog_id`)
console.table(cat)

const { rows: reparto } = await pool.query(`
  SELECT l.cat_business_line_id, c.alias, COUNT(*) AS leads
    FROM leads l LEFT JOIN catalog c ON c.catalog_id = l.cat_business_line_id
   GROUP BY 1, 2 ORDER BY 3 DESC`)
console.table(reparto)
await pool.end()
