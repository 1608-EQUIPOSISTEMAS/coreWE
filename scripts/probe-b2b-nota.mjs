// Los alumnos B2B con fila de notas: que hay realmente en cada componente.
import { q, pool } from './db.mjs'
try {
  const { rows } = await q(`
    SELECT g.enrollment_id, g.final_grade, g.test_score, g.participation_score,
           g.partial_score, g.final_deliv_score, pe.specific_code
      FROM public.enrollments e
      JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status AND cf.alias='we_enrollment_status_checked'
      JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
      JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
      JOIN public.programs p ON p.program_id = pv.program_id
      JOIN public."catalog" cm ON cm.catalog_id = p.cat_model_modality AND cm.alias='we_modality_live'
 LEFT JOIN public.enrollments es ON es.enrollment_id = COALESCE(e.parent_enrollment_id, e.enrollment_id)
 LEFT JOIN public.users usold ON usold.user_id = COALESCE(es.seller_agent_id, e.seller_agent_id)
      JOIN public.classroom_student_grades g ON g.enrollment_id = e.enrollment_id
     WHERE e.active='Y' AND pe.active='Y'
       AND (COALESCE(e.cat_b2b_doctype, es.cat_b2b_doctype) IS NOT NULL
            OR (COALESCE(es.agent_origin, e.agent_origin,'') ILIKE '%b2b%'
                AND (usold.alias IS NULL OR usold.alias IN ('NY12','JF39'))))
     ORDER BY pe.specific_code, g.final_grade`)
  console.table(rows)
} catch (e) { console.error('FALLO:', e.message) } finally { await pool.end() }
