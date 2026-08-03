// One-off: de donde sale el "ACT" que muestra FICO. El catalogo 3050 no lo tiene,
// asi que hay que ver la distribucion real y como lo arma la matview del panel.
import { q, pool } from './db.mjs'

const cat = await q(
  `SELECT catalog_id, description, alias FROM catalog
    WHERE catalog_parent_id = 3050 ORDER BY catalog_id`
)
console.log('--- catalog_parent_id = 3050 ---')
console.table(cat.rows)

const dist = await q(
  `SELECT e.cat_type_status, c.description, COUNT(*)::int AS n
     FROM enrollments e LEFT JOIN catalog c ON c.catalog_id = e.cat_type_status
    GROUP BY 1, 2 ORDER BY n DESC`
)
console.log('--- distribucion de cat_type_status en enrollments ---')
console.table(dist.rows)

const conAct = await q(
  `SELECT catalog_id, catalog_parent_id, description, alias FROM catalog
    WHERE UPPER(COALESCE(description,'')) = 'ACT'
       OR UPPER(COALESCE(alias,'')) LIKE '%active%'
       OR UPPER(COALESCE(alias,'')) LIKE '%_act%'
    ORDER BY catalog_id`
)
console.log('--- cualquier catalogo que suene a ACT ---')
console.table(conAct.rows)

// Como lo expone la matview que lee el panel FICO
const mv = await q(
  `SELECT column_name FROM information_schema.columns
    WHERE table_name = 'mv_enrollment_report_system' ORDER BY ordinal_position`
)
console.log('--- columnas de mv_enrollment_report_system ---')
console.log(mv.rows.map(r => r.column_name).join(', '))

await pool.end()
