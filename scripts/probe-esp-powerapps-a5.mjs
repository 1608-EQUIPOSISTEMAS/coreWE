// One-off: la ESP. POWER APPS Y AUT. del 12/09 quedo A5 (cancelada) y producto
// dice que sus 2 ventas "pasaron al 20". Ver que quedo realmente en la BD:
// estado de las ediciones, del padre y de los hijos, y si hubo RP / CC.
import { q, pool } from './db.mjs'

const ediciones = await q(`
  SELECT pe.edition_num_id, pe.global_code, p.program_name, pe.start_date, pe.end_date,
         cseg.description AS segmento, cseg.alias AS segmento_alias, pe.active
    FROM public.program_editions pe
    JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN public.programs p ON p.program_id = pv.program_id
    LEFT JOIN public."catalog" cseg ON cseg.catalog_id = pe.cat_segment
   WHERE pe.edition_num_id = ANY($1::int[])`, [[15435, 15441, 15101, 15123]])
console.log('\n== EDICIONES ==')
console.table(ediciones.rows)

const arbol = await q(`
  SELECT e.enrollment_id, e.parent_enrollment_id, e.program_edition_id,
         p.program_name, pe.global_code, pe.start_date,
         e.total_amount, e.active,
         cf.alias  AS fico_status,
         cts.alias AS tipo_estado,
         e.registration_date, e.modification_date,
         LEFT(COALESCE(e.notes,''), 160) AS notas
    FROM public.enrollments e
    LEFT JOIN public."catalog" cf  ON cf.catalog_id  = e.cat_fico_status
    LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.programs p ON p.program_id = pv.program_id
   WHERE e.enrollment_id = ANY($1::int[])
      OR e.parent_enrollment_id = ANY($1::int[])
   ORDER BY COALESCE(e.parent_enrollment_id, e.enrollment_id), e.enrollment_id`,
  [[13604, 13647]])
console.log('\n== ARBOL DE LAS 2 VENTAS ==')
console.table(arbol.rows)

const ids = arbol.rows.map(r => r.enrollment_id)

const cc = await q(`
  SELECT * FROM public.course_changes
   WHERE enrollment_origin_id = ANY($1::int[])
      OR enrollment_destination_id = ANY($1::int[])`, [ids])
console.log('\n== COURSE_CHANGES (CC / RP) ==')
console.table(cc.rows)

// Personas de esas 2 ventas: buscar si tienen OTRA inscripcion (la del 20/09).
const otras = await q(`
  SELECT e.enrollment_id, e.parent_enrollment_id, e.program_edition_id,
         p.program_name, pe.global_code, pe.start_date, e.total_amount,
         cf.alias AS fico_status, cts.alias AS tipo_estado, e.active, e.registration_date
    FROM public.enrollments e
    JOIN public.customers c ON c.customer_id = e.customer_id
    LEFT JOIN public."catalog" cf  ON cf.catalog_id  = e.cat_fico_status
    LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.programs p ON p.program_id = pv.program_id
   WHERE c.person_id IN (
           SELECT c2.person_id FROM public.customers c2
             JOIN public.enrollments e2 ON e2.customer_id = c2.customer_id
            WHERE e2.enrollment_id = ANY($1::int[]))
   ORDER BY c.person_id, e.enrollment_id`, [[13604, 13647]])
console.log('\n== TODAS LAS INSCRIPCIONES DE ESAS 2 PERSONAS ==')
console.table(otras.rows)

await pool.end()
