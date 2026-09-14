import { pool } from '../../../shared/db/pool.js'
import { editionRepository } from '../../edition/edition.repository.js'
import { GRADE_RULES } from '../../edition/edition.entity.js'

// Filas crudas del panel de Académica. Aula = curso activo que no es A5, el
// mismo universo del Control de Ediciones (edition.repository _controlSelect).
const CLASSROOM_JOINS = `
        JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
        JOIN public.programs p          ON p.program_id = pv.program_id
        JOIN public."catalog" ctp       ON ctp.catalog_id = p.cat_type_program
                                       AND ctp.alias = 'we_program_type_course'
        LEFT JOIN public."catalog" seg  ON seg.catalog_id = pe.cat_segment`
const LIVE_CLASSROOM = `pe.active = 'Y' AND COALESCE(seg.alias, '') <> 'we_segment_a5'`

// Cómo se reconoce un aula en pantalla: "BI-CP-03 E4-26" (versión + edición),
// igual que en el cronograma. Asume los alias `pv` y `pe`.
const CLASSROOM_CODE = `concat_ws(' ', pv.version_code, pe.specific_code)`

export async function fetchAcademicaRaw (_scope, db = pool, editions = editionRepository) {
  const [aulasSemana, aulasFinalizadas] = await Promise.all([
    // Aulas en curso la semana ISO actual y la de hace 4 semanas (el
    // comparativo). Sin el margen de 45 días de weeklyControlEditions: aquí se
    // cuenta el aula que dicta, no las sesiones reprogramadas que se estiran.
    db.query(`
      SELECT s.semana, pe.edition_num_id,
             p.program_name AS programa, ${CLASSROOM_CODE} AS codigo,
             pe.instructor_id IS NULL AS sin_docente,
             pe.start_date::date >= s.lunes AS inicia,
             pe.end_date::date <= s.lunes + 6 AS termina
        FROM (VALUES ('actual', date_trunc('week', CURRENT_DATE)::date),
                     ('hace_4', (date_trunc('week', CURRENT_DATE) - interval '4 weeks')::date)) s(semana, lunes)
        JOIN public.program_editions pe
          ON pe.start_date::date <= s.lunes + 6 AND pe.end_date::date >= s.lunes
        ${CLASSROOM_JOINS}
       WHERE ${LIVE_CLASSROOM}`),

    // Aulas que terminaron en los últimos 60 días: notas y certificados.
    // "Tiene nota" NO es final_grade IS NOT NULL: la fila de notas se crea al
    // abrir el aula con ceros, así que se mira que alguien haya cargado algo.
    db.query(`
      SELECT pe.edition_num_id,
             p.program_name AS programa, ${CLASSROOM_CODE} AS codigo,
             pe.end_date::date::text AS fin,
             COUNT(g.grade_id) FILTER (WHERE g.partial_score > 0 OR g.final_criteria <> '{}'::jsonb)::int AS con_nota,
             COUNT(g.grade_id) FILTER (WHERE g.final_grade >= $1)::int AS aprobados,
             COUNT(g.grade_id) FILTER (WHERE g.final_grade >= $1 AND g.odoo_cert_code IS NOT NULL)::int AS certificados
        FROM public.program_editions pe
        ${CLASSROOM_JOINS}
        LEFT JOIN public.classroom_student_grades g ON g.program_edition_id = pe.edition_num_id
       WHERE ${LIVE_CLASSROOM}
         AND pe.end_date::date >= CURRENT_DATE - 60
         AND pe.end_date::date <  CURRENT_DATE
       GROUP BY pe.edition_num_id, p.program_name, pv.version_code, pe.specific_code, pe.end_date`,
    [GRADE_RULES.PASS_THRESHOLD])
  ])

  // AULA real (VENTAS+SEGUI+MEMB+B2B, sin becas) del cronograma; recontarlo
  // aquí sería una segunda regla que diverge de la que ve Producto.
  const enCurso = aulasSemana.rows.filter(r => r.semana === 'actual').map(r => Number(r.edition_num_id))
  const aulaMetricas = enCurso.length ? await editions.classroomChannelMetricsList(enCurso) : []

  return {
    aulasSemana: aulasSemana.rows,
    aulasFinalizadas: aulasFinalizadas.rows,
    aulaMetricas
  }
}
