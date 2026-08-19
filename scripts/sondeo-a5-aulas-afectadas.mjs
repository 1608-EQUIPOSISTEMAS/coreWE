// Todas las aulas VIVAS que cuentan alumnos varados por un padre A5 (diploma
// cancelado). Antes del fix esos alumnos inflaban la columna AULA del cronograma.
import { q, pool } from './db.mjs'

const { rows } = await q(`
  SELECT pe.edition_num_id, pe.specific_code, p.program_name, pe.start_date,
         cseg.alias AS segmento,
         COUNT(*)::int AS varados,
         string_agg(DISTINCT pp.program_name || ' (ed ' || pep.edition_num_id || ')', ' | ') AS padres_a5
    FROM public.enrollments e
    JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
    LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
    JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public."catalog" cseg ON cseg.catalog_id = pe.cat_segment
    JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN public.programs p ON p.program_id = pv.program_id
    JOIN public.enrollments par ON par.enrollment_id = e.parent_enrollment_id
    LEFT JOIN public."catalog" parcts ON parcts.catalog_id = par.cat_type_status
    JOIN public.program_editions pep ON pep.edition_num_id = par.program_edition_id
    JOIN public."catalog" psg ON psg.catalog_id = pep.cat_segment AND psg.alias = 'we_segment_a5'
    JOIN public.program_versions pvp ON pvp.program_version_id = pep.program_version_id
    JOIN public.programs pp ON pp.program_id = pvp.program_id
   WHERE e.active = 'Y'
     AND cf.alias = 'we_enrollment_status_checked'
     AND (cts.alias IS NULL OR cts.alias NOT IN ('we_enrollment_status_retired',
          'we_enrollment_status_course_changed','we_enrollment_status_reprogrammed'))
     AND (parcts.alias IS NULL OR parcts.alias <> 'we_enrollment_status_reprogrammed')
     AND NOT EXISTS (SELECT 1 FROM public.enrollments ch WHERE ch.parent_enrollment_id = e.enrollment_id)
     AND (cseg.alias IS NULL OR cseg.alias <> 'we_segment_a5')   -- el aula propia sigue viva
   GROUP BY 1,2,3,4,5
   ORDER BY varados DESC, pe.start_date`)

console.table(rows.map(r => ({
  aula: r.edition_num_id, codigo: r.specific_code, seg: r.segmento,
  programa: r.program_name.slice(0, 34),
  inicio: r.start_date?.toISOString().slice(0, 10), varados: r.varados,
  padres_a5: r.padres_a5.slice(0, 60)
})))
console.log('aulas afectadas:', rows.length,
            '| alumnos varados contados de mas:', rows.reduce((s, r) => s + r.varados, 0))
await pool.end()
