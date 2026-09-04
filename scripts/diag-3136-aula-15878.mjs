// Diagnostico one-off: por que el enrollment 3136 no sale en la Lista de Notas
// del aula 15878. Los 7 varados de la edicion A5 15673 y si alguno ya migro.
import { q, pool } from './db.mjs'

const { rows: varados } = await q(`
  SELECT e.enrollment_id,
         TRIM(concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS nombre,
         per.document_number AS dni,
         cts.alias AS type_status,
         e.registration_date::date AS inscrito_el,
         e.total_amount,
         -- ya tiene destino? (RP o CC hacia otra edicion)
         (SELECT cc.enrollment_destination_id FROM course_changes cc
           WHERE cc.enrollment_origin_id = e.enrollment_id LIMIT 1) AS destino_cc
    FROM enrollments e
    JOIN customers cust ON cust.customer_id = e.customer_id
    JOIN persons per ON per.person_id = cust.person_id
    JOIN catalog cf ON cf.catalog_id = e.cat_fico_status
    LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
   WHERE e.program_edition_id = 15673 AND e.active = 'Y'
     AND cf.alias = 'we_enrollment_status_checked'
   ORDER BY e.enrollment_id`)
console.log('=== VARADOS EN LA EDICION A5 15673 (PY-CZ-06 E6-26) ===')
console.table(varados)

await pool.end()
