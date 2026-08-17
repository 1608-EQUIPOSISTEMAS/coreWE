// Barrido: ediciones canceladas (A5) que todavia tienen inscripciones VIVAS.
//
// Una edicion A5 no mueve inscripciones (cat_segment es metadata de la edicion).
// Si nadie reprograma las ventas, sus hijos siguen inflando el AULA de los cursos
// del arbol, y con la fila padre oculta del cronograma el descuadre es invisible.
// Caso que lo destapo: ESP. POWER APPS E23 (15435) -> ver rp-esp-powerapps-*.mjs
import { q, pool } from './db.mjs'

const { rows } = await q(`
  SELECT pe.edition_num_id, pe.global_code, p.program_name,
         pe.start_date::date AS inicio, pe.active,
         COUNT(*) FILTER (WHERE e.parent_enrollment_id IS NULL)::int AS ventas_vivas,
         COUNT(*) FILTER (WHERE e.parent_enrollment_id IS NOT NULL)::int AS hijos_vivos,
         -- hijos que cuelgan de esas ventas y siguen ocupando OTRA aula
         (SELECT COUNT(*)::int
            FROM public.enrollments ch
            JOIN public."catalog" cfc ON cfc.catalog_id = ch.cat_fico_status
            LEFT JOIN public."catalog" ctc ON ctc.catalog_id = ch.cat_type_status
           WHERE ch.parent_enrollment_id IN (
                   SELECT e2.enrollment_id FROM public.enrollments e2
                    WHERE e2.program_edition_id = pe.edition_num_id AND e2.active = 'Y')
             AND ch.active = 'Y'
             AND cfc.alias = 'we_enrollment_status_checked'
             AND (ctc.alias IS NULL OR ctc.alias NOT IN (
                    'we_enrollment_status_retired',
                    'we_enrollment_status_course_changed',
                    'we_enrollment_status_reprogrammed'))) AS hijos_en_otras_aulas
    FROM public.program_editions pe
    JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN public.programs p ON p.program_id = pv.program_id
    JOIN public."catalog" cseg ON cseg.catalog_id = pe.cat_segment AND cseg.alias = 'we_segment_a5'
    JOIN public.enrollments e ON e.program_edition_id = pe.edition_num_id AND e.active = 'Y'
    JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
                            AND cf.alias = 'we_enrollment_status_checked'
    LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
   WHERE cts.alias IS NULL OR cts.alias NOT IN (
           'we_enrollment_status_retired',
           'we_enrollment_status_course_changed',
           'we_enrollment_status_reprogrammed')
   GROUP BY pe.edition_num_id, pe.global_code, p.program_name, pe.start_date, pe.active
   ORDER BY pe.start_date DESC`)

console.table(rows)
console.log(`\n${rows.length} edicion(es) A5 con inscripciones vivas.`)
console.log(`Ventas sin reprogramar: ${rows.reduce((s, r) => s + r.ventas_vivas, 0)}`)
console.log(`Hijos inflando otras aulas: ${rows.reduce((s, r) => s + r.hijos_en_otras_aulas, 0)}`)
await pool.end()
