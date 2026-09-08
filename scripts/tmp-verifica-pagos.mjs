import fs from 'node:fs'
import pg from 'pg'
const url = fs.readFileSync('.env.bak-produccion','utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim()
const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000 })
await c.connect()
const q = (s,p) => c.query(s,p).then(r=>r.rows)
console.log('-- enrollments con MAS DE UN pago de compra (3113/3115) en el periodo:')
console.table(await q(`
  SELECT n_pagos, COUNT(*)::int enrollments FROM (
    SELECT pa.enrollment_id, COUNT(*)::int n_pagos
      FROM payments pa WHERE pa.active='Y' AND pa.cat_payment_type IN (3113,3115)
       AND pa.payment_date>='2026-01-01' AND pa.payment_date<'2026-09-01'
     GROUP BY 1) t GROUP BY 1 ORDER BY 1`))
console.log('-- ejemplo de uno con 2 pagos de compra:')
console.table(await q(`
  SELECT pa.enrollment_id, pa.amount, pa.payment_date::date, ct.description
    FROM payments pa JOIN catalog ct ON ct.catalog_id=pa.cat_payment_type
   WHERE pa.enrollment_id IN (
     SELECT enrollment_id FROM payments WHERE active='Y' AND cat_payment_type IN (3113,3115)
      AND payment_date>='2026-01-01' AND payment_date<'2026-09-01'
      GROUP BY 1 HAVING COUNT(*)>1 LIMIT 1)
   ORDER BY pa.payment_date`))
console.log('-- inscripciones SIN ningun pago de compra (becas / monto 0) en ediciones 2026:')
console.table(await q(`
  SELECT COUNT(*)::int sin_pago FROM enrollments e
    JOIN program_editions pe ON pe.edition_num_id=e.program_edition_id
   WHERE e.active='Y' AND pe.start_date>='2026-01-01' AND pe.start_date<'2026-09-01'
     AND e.parent_enrollment_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM payments pa WHERE pa.enrollment_id=e.enrollment_id AND pa.cat_payment_type IN (3113,3115))`))
await c.end()
