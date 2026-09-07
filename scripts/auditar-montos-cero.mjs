// Hallazgo 3: ventas en total 0 despues del 11/08 y cuotas de importe 0.
// La pregunta no es "por que 0" sino "que dato falta para que el 0 se explique
// solo": categoria de entrada del evento, precio de lista, o un descuento que
// nadie registro.
import { q, pool } from './prod-db.mjs'

console.log('=== Las OS/OP en 0: como se justifica el cero ===')
console.table((await q(`
  SELECT e.enrollment_id AS id,
         TRIM(concat_ws(' ', per.first_name, per.last_name)) AS alumno,
         pv.abbreviation AS programa, pe.specific_code AS ed,
         e.list_price::numeric AS lista, e.discount_amount::numeric AS dscto,
         e.total_amount::numeric AS total,
         cec.description AS categoria_entrada,
         (SELECT COUNT(*)::int FROM enrollment_discounts ed2
           WHERE ed2.enrollment_id = e.enrollment_id) AS descuentos,
         CASE
           WHEN cec.description IS NOT NULL THEN 'entrada de cortesia (categoria)'
           WHEN e.list_price = 0 THEN 'el producto se registro con precio 0'
           ELSE 'SIN EXPLICACION: lista > 0, sin descuento y total 0'
         END AS lectura
    FROM enrollments e
    JOIN catalog cbd ON cbd.catalog_id = e.cat_b2b_doctype
    JOIN catalog cf ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
    JOIN customers cu ON cu.customer_id = e.customer_id
    JOIN persons per ON per.person_id = cu.person_id
    LEFT JOIN catalog cec ON cec.catalog_id = e.cat_event_category
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
   WHERE e.active = 'Y' AND e.total_amount = 0
     AND cbd.alias IN ('we_enrollment_b2b_doctype_service_order','we_enrollment_b2b_doctype_purchase_order')
     AND e.registration_date >= '2026-08-11'
   ORDER BY e.enrollment_id`)).rows)

console.log('\n=== Cuotas de importe 0 que quedan pendientes para siempre ===')
console.table((await q(`
  SELECT COUNT(*)::int AS cuotas_cero_pendientes,
         COUNT(DISTINCT pi.enrollment_id)::int AS inscripciones,
         MIN(pi.due_date)::date AS vencimiento_mas_viejo
    FROM payment_installments pi
    JOIN catalog cs ON cs.catalog_id = pi.cat_status
    JOIN enrollments e ON e.enrollment_id = pi.enrollment_id AND e.active = 'Y'
   WHERE pi.amount = 0
     AND cs.alias NOT IN ('we_inst_paid','we_payment_status_paid')`)).rows)

console.log('\n=== ¿Se cuelan en la cobranza? (mismo criterio: pendiente y vencida) ===')
console.table((await q(`
  SELECT CASE WHEN pi.amount = 0 THEN 'cuota de importe 0' ELSE 'cuota con importe' END AS tipo,
         COUNT(*)::int AS cuotas, SUM(pi.amount)::numeric AS monto
    FROM payment_installments pi
    JOIN catalog cs ON cs.catalog_id = pi.cat_status
    JOIN enrollments e ON e.enrollment_id = pi.enrollment_id AND e.active = 'Y'
   WHERE cs.alias NOT IN ('we_inst_paid','we_payment_status_paid')
     AND pi.due_date < CURRENT_DATE
   GROUP BY 1 ORDER BY cuotas DESC`)).rows)

await pool.end()
