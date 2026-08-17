// Dump completo de las ediciones A5 con alumnos vivos, para que Producto decida
// destino caso por caso. Solo lectura. Escribe _a5_detalle_producto.json.
//
// Dos grupos: las que tienen edicion futura del mismo programa (migrables con RP)
// y las que no (programa descontinuado: el RP no es una opcion que exista).
import { writeFileSync } from 'node:fs'
import { q, pool } from './db.mjs'

const VIVO = `e.active = 'Y'
  AND cf.alias = 'we_enrollment_status_checked'
  AND (cts.alias IS NULL OR cts.alias NOT IN (
         'we_enrollment_status_retired',
         'we_enrollment_status_course_changed',
         'we_enrollment_status_reprogrammed'))`

const { rows: ediciones } = await q(`
  SELECT DISTINCT pe.edition_num_id, pe.global_code, pe.program_version_id,
         p.program_name, pe.start_date::date AS inicio, pe.end_date::date AS fin
    FROM public.program_editions pe
    JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN public.programs p ON p.program_id = pv.program_id
    JOIN public."catalog" cseg ON cseg.catalog_id = pe.cat_segment AND cseg.alias = 'we_segment_a5'
    JOIN public.enrollments e ON e.program_edition_id = pe.edition_num_id
    JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
    LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
   WHERE ${VIVO}
   ORDER BY pe.start_date DESC`)

const salida = []

for (const ed of ediciones) {
  const { rows: alumnos } = await q(`
    SELECT e.enrollment_id,
           (e.parent_enrollment_id IS NOT NULL) AS is_child,
           TRIM(CONCAT_WS(' ', per.first_name, per.last_name, per.mother_last_name)) AS full_name,
           per.document_number,
           COALESCE((SELECT SUM(pay.amount) FROM public.payments pay
                      WHERE pay.enrollment_id = e.enrollment_id AND pay.active = 'Y'), 0) AS pagado,
           pp.program_name AS parent_program_name,
           pep.global_code AS parent_edition_code
      FROM public.enrollments e
      JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
      LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
      JOIN public.customers cust ON cust.customer_id = e.customer_id
      JOIN public.persons per ON per.person_id = cust.person_id
      LEFT JOIN public.enrollments par ON par.enrollment_id = e.parent_enrollment_id
      LEFT JOIN public.program_versions ppv ON ppv.program_version_id = par.program_version_id
      LEFT JOIN public.programs pp ON pp.program_id = ppv.program_id
      LEFT JOIN public.program_editions pep ON pep.edition_num_id = par.program_edition_id
     WHERE e.program_edition_id = $1 AND ${VIVO}
     ORDER BY is_child, full_name`, [ed.edition_num_id])

  // Hijos de esas ventas que hoy ocupan silla en OTRA aula que si se dicta.
  const { rows: hijosFuera } = await q(`
    SELECT ch.enrollment_id, p2.program_name, pe2.global_code, pe2.start_date::date AS inicio,
           TRIM(CONCAT_WS(' ', per.first_name, per.last_name)) AS full_name
      FROM public.enrollments ch
      JOIN public."catalog" cf ON cf.catalog_id = ch.cat_fico_status
      LEFT JOIN public."catalog" cts ON cts.catalog_id = ch.cat_type_status
      JOIN public.customers cust ON cust.customer_id = ch.customer_id
      JOIN public.persons per ON per.person_id = cust.person_id
      LEFT JOIN public.program_editions pe2 ON pe2.edition_num_id = ch.program_edition_id
      LEFT JOIN public.program_versions pv2 ON pv2.program_version_id = pe2.program_version_id
      LEFT JOIN public.programs p2 ON p2.program_id = pv2.program_id
     WHERE ch.parent_enrollment_id IN (
             SELECT e2.enrollment_id FROM public.enrollments e2
              WHERE e2.program_edition_id = $1 AND e2.active = 'Y')
       AND ch.active = 'Y'
       AND cf.alias = 'we_enrollment_status_checked'
       AND (cts.alias IS NULL OR cts.alias NOT IN (
              'we_enrollment_status_retired',
              'we_enrollment_status_course_changed',
              'we_enrollment_status_reprogrammed'))
     ORDER BY pe2.start_date`.replace('${VIVO}', ''), [ed.edition_num_id])

  const { rows: candidatas } = await q(`
    SELECT pe.edition_num_id, pe.global_code, pe.start_date::date AS inicio
      FROM public.program_editions pe
      LEFT JOIN public."catalog" cseg ON cseg.catalog_id = pe.cat_segment
     WHERE pe.program_version_id = $1 AND pe.edition_num_id <> $2
       AND pe.active = 'Y' AND COALESCE(cseg.alias, '') <> 'we_segment_a5'
       AND pe.start_date >= CURRENT_DATE
     ORDER BY pe.start_date`, [ed.program_version_id, ed.edition_num_id])

  salida.push({ ...ed, alumnos, hijosFuera, candidatas, migrable: candidatas.length > 0 })
}

writeFileSync(new URL('./_a5_detalle_producto.json', import.meta.url), JSON.stringify(salida, null, 2))

const migrables = salida.filter(e => e.migrable)
const huerfanas = salida.filter(e => !e.migrable)
const cuenta = (list, f) => list.reduce((s, e) => s + e[f].length, 0)
console.log(`MIGRABLES: ${migrables.length} ediciones, ${cuenta(migrables, 'alumnos')} alumnos, ${cuenta(migrables, 'hijosFuera')} hijos fuera`)
console.log(`SIN DESTINO: ${huerfanas.length} ediciones, ${cuenta(huerfanas, 'alumnos')} alumnos, ${cuenta(huerfanas, 'hijosFuera')} hijos fuera`)
console.log('-> _a5_detalle_producto.json')
await pool.end()
