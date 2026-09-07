// Detalle de los pendientes de datos que quedan (sin el grupo E0, aparcado):
// modalidad de hijos desalineada, hijos sin edicion, cuotas en 0 y ventas cuyas
// cuotas no cuadran. Uno por uno, con nombres, para poder decidir cada caso.
import { q, pool } from './prod-db.mjs'

console.log('=== 1. Modalidad del hijo distinta a la del padre ===')
console.table((await q(`
  SELECT h.enrollment_id AS hijo, p.enrollment_id AS padre,
         TRIM(concat_ws(' ', per.first_name, per.last_name)) AS alumno,
         pvh.abbreviation AS modulo, peh.specific_code AS ed,
         cmh.description AS modalidad_hijo, cmp.description AS modalidad_padre,
         peh.start_date::date AS inicio
    FROM enrollments h
    JOIN enrollments p ON p.enrollment_id = h.parent_enrollment_id
    JOIN customers cu ON cu.customer_id = h.customer_id
    JOIN persons per ON per.person_id = cu.person_id
    LEFT JOIN program_versions pvh ON pvh.program_version_id = h.program_version_id
    LEFT JOIN program_editions peh ON peh.edition_num_id = h.program_edition_id
    LEFT JOIN catalog cmh ON cmh.catalog_id = h.cat_inscription_modality
    LEFT JOIN catalog cmp ON cmp.catalog_id = p.cat_inscription_modality
   WHERE h.active = 'Y' AND p.active = 'Y'
     AND h.cat_inscription_modality IS DISTINCT FROM p.cat_inscription_modality
   ORDER BY peh.start_date DESC NULLS LAST`)).rows)

console.log('\n=== 2. Hijos sin edicion asignada ===')
console.table((await q(`
  SELECT h.enrollment_id AS hijo, h.parent_enrollment_id AS padre,
         TRIM(concat_ws(' ', per.first_name, per.last_name)) AS alumno,
         pvh.abbreviation AS modulo, cts.description AS estado,
         h.registration_date::date AS creado,
         (SELECT COUNT(*) FROM program_editions pe2
           WHERE pe2.program_version_id = h.program_version_id AND pe2.active = 'Y')::int AS ediciones_del_curso
    FROM enrollments h
    JOIN customers cu ON cu.customer_id = h.customer_id
    JOIN persons per ON per.person_id = cu.person_id
    LEFT JOIN program_versions pvh ON pvh.program_version_id = h.program_version_id
    LEFT JOIN catalog cts ON cts.catalog_id = h.cat_type_status
   WHERE h.active = 'Y' AND h.parent_enrollment_id IS NOT NULL AND h.program_edition_id IS NULL
   ORDER BY h.registration_date DESC`)).rows)

console.log('\n=== 3. Cuotas de importe 0 pendientes: de donde salen ===')
console.table((await q(`
  SELECT to_char(date_trunc('month', e.registration_date), 'YYYY-MM') AS mes_venta,
         COUNT(*)::int AS cuotas,
         COUNT(*) FILTER (WHERE e.total_amount = 0)::int AS de_ventas_en_cero,
         COUNT(*) FILTER (WHERE e.cat_b2b_doctype IS NOT NULL)::int AS con_documento_b2b
    FROM payment_installments pi
    JOIN catalog cs ON cs.catalog_id = pi.cat_status
    JOIN enrollments e ON e.enrollment_id = pi.enrollment_id AND e.active = 'Y'
   WHERE pi.amount = 0 AND cs.alias NOT IN ('we_inst_paid','we_payment_status_paid')
   GROUP BY 1 ORDER BY 1`)).rows)

await pool.end()
