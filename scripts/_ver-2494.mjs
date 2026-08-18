import { q, pool } from './db.mjs'
console.log('--- pago 2217 completo ---')
console.log((await q(`SELECT * FROM payments WHERE enrollment_id = 2494`)).rows)
console.log('--- hermanos Molitalia (misma nota) ---')
console.table((await q(`
  SELECT e.enrollment_id, e.total_amount, e.cat_payment_plan,
         substring(replace(e.notes,E'\n',' ') from 'personas. \(([0-9]/5)\)') AS quien,
         pi.installment_id, pi.installment_number, pi.amount AS cuota, pi.cat_status,
         (SELECT count(*) FROM payments p WHERE p.enrollment_id = e.enrollment_id AND p.active='Y') AS pagos,
         (SELECT sum(p.amount) FROM payments p WHERE p.enrollment_id = e.enrollment_id AND p.active='Y') AS pagado
    FROM enrollments e
    LEFT JOIN payment_installments pi ON pi.enrollment_id = e.enrollment_id
   WHERE e.notes LIKE '%Molitalia%' AND e.active='Y'
   ORDER BY e.enrollment_id, pi.installment_number`)).rows)
await pool.end()
