// One-off (sigue a probe-esp-powerapps-a5.mjs): quienes son los 2 alumnos de la
// ESP 15435 (A5) y si ya existe su venta en la ESP del 20/09 (15441).
import { q, pool } from './db.mjs'

const quienes = await q(`
  SELECT e.enrollment_id, c.customer_id, c.person_id,
         pr.first_name, pr.last_name, pr.document_number
    FROM public.enrollments e
    JOIN public.customers c ON c.customer_id = e.customer_id
    JOIN public.persons pr  ON pr.person_id  = c.person_id
   WHERE e.enrollment_id = ANY($1::int[])`, [[13604, 13647]])
console.log('\n== ALUMNOS ==')
console.table(quienes.rows)

const personIds = [...new Set(quienes.rows.map(r => r.person_id))]

const suyas = await q(`
  SELECT e.enrollment_id, c.person_id, e.parent_enrollment_id, e.program_edition_id,
         p.program_name, pe.global_code, pe.start_date, e.total_amount,
         cts.alias AS tipo_estado, e.active, e.registration_date
    FROM public.enrollments e
    JOIN public.customers c ON c.customer_id = e.customer_id
    LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.programs p ON p.program_id = pv.program_id
   WHERE c.person_id = ANY($1::int[])
     AND p.program_name ILIKE '%POWER APPS%'
   ORDER BY c.person_id, e.registration_date`, [personIds])
console.log('\n== SUS INSCRIPCIONES DE POWER APPS ==')
console.table(suyas.rows)

const enDestino = await q(`
  SELECT e.enrollment_id, c.person_id, pr.first_name, pr.last_name, e.total_amount,
         cts.alias AS tipo_estado, e.active, e.registration_date,
         LEFT(COALESCE(e.notes,''), 120) AS notas
    FROM public.enrollments e
    JOIN public.customers c ON c.customer_id = e.customer_id
    JOIN public.persons pr  ON pr.person_id  = c.person_id
    LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
   WHERE e.program_edition_id = 15441
   ORDER BY e.enrollment_id`)
console.log('\n== QUIEN ESTA EN LA ESP DEL 20/09 (15441) ==')
console.table(enDestino.rows)

const versiones = await q(`
  SELECT edition_num_id, global_code, program_version_id
    FROM public.program_editions WHERE edition_num_id = ANY($1::int[])`, [[15435, 15441]])
console.log('\n== program_version_id (la guarda del RP exige que sean iguales) ==')
console.table(versiones.rows)

const arbolDestino = await q(`
  SELECT es.parent_edition_id, es.child_edition_id, p.program_name,
         pe.global_code, pe.start_date
    FROM public.edition_structure es
    JOIN public.program_editions pe ON pe.edition_num_id = es.child_edition_id
    JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN public.programs p ON p.program_id = pv.program_id
   WHERE es.parent_edition_id = ANY($1::int[])
   ORDER BY es.parent_edition_id, pe.start_date`, [[15435, 15441]])
console.log('\n== CURSOS HIJOS DE CADA ESP ==')
console.table(arbolDestino.rows)

await pool.end()
