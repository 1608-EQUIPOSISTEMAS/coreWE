// Invariante: TODO alumno que el cronograma deja de contar por tener un padre A5
// tiene que salir en la bandeja de Reprogramaciones (1 fila = la venta padre).
// Se replica el CTE `caida` del repo SIN tocar reprogram_cases: esa tabla aun no
// existe en produccion (el modulo esta sin DDL alla) y aqui solo interesa saber
// si la venta es elegible para la bandeja.
import { q, pool } from './db.mjs'

const { rows } = await q(`
  WITH varado AS (
    SELECT e.enrollment_id, e.parent_enrollment_id
      FROM public.enrollments e
      JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
      LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
      JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
      LEFT JOIN public."catalog" cseg ON cseg.catalog_id = pe.cat_segment
      JOIN public.enrollments par ON par.enrollment_id = e.parent_enrollment_id
      LEFT JOIN public."catalog" parcts ON parcts.catalog_id = par.cat_type_status
      JOIN public.program_editions pep ON pep.edition_num_id = par.program_edition_id
      JOIN public."catalog" psg ON psg.catalog_id = pep.cat_segment AND psg.alias = 'we_segment_a5'
     WHERE e.active = 'Y'
       AND cf.alias = 'we_enrollment_status_checked'
       AND (cts.alias IS NULL OR cts.alias NOT IN ('we_enrollment_status_retired',
            'we_enrollment_status_course_changed','we_enrollment_status_reprogrammed'))
       AND (parcts.alias IS NULL OR parcts.alias <> 'we_enrollment_status_reprogrammed')
       AND NOT EXISTS (SELECT 1 FROM public.enrollments ch WHERE ch.parent_enrollment_id = e.enrollment_id)
       AND (cseg.alias IS NULL OR cseg.alias <> 'we_segment_a5')
  ), bandeja AS (   -- espejo del CTE caida de listAffected
    SELECT COALESCE(e.parent_enrollment_id, e.enrollment_id) AS venta_id
      FROM public.enrollments e
      JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
      LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
      JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
      JOIN public."catalog" cseg ON cseg.catalog_id = pe.cat_segment AND cseg.alias = 'we_segment_a5'
     WHERE e.active = 'Y'
       AND cf.alias = 'we_enrollment_status_checked'
       AND (cts.alias IS NULL OR cts.alias NOT IN ('we_enrollment_status_retired',
            'we_enrollment_status_course_changed','we_enrollment_status_reprogrammed'))
  )
  SELECT (SELECT COUNT(*) FROM varado)::int AS varados,
         (SELECT COUNT(*) FROM varado v
           WHERE v.parent_enrollment_id NOT IN (SELECT venta_id FROM bandeja))::int AS huerfanos,
         (SELECT COUNT(DISTINCT venta_id) FROM bandeja)::int AS filas_bandeja`)

const [r] = rows
console.log(r)
console.assert(r.huerfanos === 0, 'hay varados que no llegan a Reprogramaciones')
await pool.end()
