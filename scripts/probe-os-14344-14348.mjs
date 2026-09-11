// Foto de plata de las OS del flujo viejo 14344-14348 (retenidas en
// HELD_ENROLLMENT_IDS): cabecera, cuotas, pagos e hijas, para decidir el ajuste
// de monto y la liberacion al sync sin adivinar.
//   cd Backend && node scripts/probe-os-14344-14348.mjs
import { q, pool } from './db.mjs'

const IDS = [14344, 14345, 14346, 14347, 14348]

console.log('BD:', (await q('SELECT current_database() AS db')).rows[0].db)

console.table((await q(`
  SELECT e.enrollment_id AS id, e.parent_enrollment_id AS padre, e.active,
         cf.alias AS fico, cd.alias AS doctype,
         e.list_price, e.discount_amount AS dsct, e.total_amount AS total,
         l.origin_email AS correo,
         (SELECT COUNT(*) FROM enrollments h WHERE h.parent_enrollment_id = e.enrollment_id) AS hijos,
         LEFT(e.notes, 100) AS notes
    FROM enrollments e
    LEFT JOIN "catalog" cf ON cf.catalog_id = e.cat_fico_status
    LEFT JOIN "catalog" cd ON cd.catalog_id = e.cat_b2b_doctype
    LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
   WHERE e.enrollment_id = ANY($1::int[])
   ORDER BY 1`, [IDS])).rows)

console.table((await q(`
  SELECT pi.enrollment_id AS id, pi.installment_id, pi.installment_number AS n,
         pi.amount, c.alias AS estado, pi.due_date
    FROM payment_installments pi
    LEFT JOIN "catalog" c ON c.catalog_id = pi.cat_status
   WHERE pi.enrollment_id = ANY($1::int[])
   ORDER BY 1, pi.installment_number`, [IDS])).rows)

console.table((await q(`
  SELECT py.enrollment_id AS id, py.payment_id, py.installment_id, py.amount,
         py.active, py.payment_date
    FROM payments py
   WHERE py.enrollment_id = ANY($1::int[])
   ORDER BY 1, py.payment_id`, [IDS])).rows)

console.table((await q(`
  SELECT h.parent_enrollment_id AS padre, h.enrollment_id AS hija, h.total_amount, h.active
    FROM enrollments h
   WHERE h.parent_enrollment_id = ANY($1::int[])
   ORDER BY 1, 2`, [IDS])).rows)

await pool.end()
