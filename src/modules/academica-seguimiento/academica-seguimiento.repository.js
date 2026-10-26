import { pool } from '../../shared/db/pool.js'
import { STUDENT_EMAIL_SQL } from '../../utils/student-contacts.sql.js'
import { hasAnyGradeSql } from '../../utils/classroom-grades.sql.js'
import { ALIAS } from '../../utils/catalog-aliases.js'

// Unico que habla con la BD. Solo lectura: las notas las carga el aula
// (edition, Lista de Notas); aqui se consultan.

// Alumnos de un aula: MISMO universo que el contador "Alumnos" de Aulas
// (st en edition.repository academicReportList): inscripcion activa,
// confirmada por FICO y que no sea padre de paquete (el alumno es el hijo).
// Si cambia alla, cambia aqui, o los totales de las dos pantallas no cuadran.
const STUDENTS_FROM = `
  FROM public.enrollments e
  JOIN public.catalog cf ON cf.catalog_id = e.cat_fico_status
                        AND cf.alias = 'we_enrollment_status_checked'
  LEFT JOIN public.classroom_student_grades g ON g.program_edition_id = e.program_edition_id
                                             AND g.enrollment_id = e.enrollment_id`
const IS_STUDENT = `e.active = 'Y'
    AND NOT EXISTS (SELECT 1 FROM public.enrollments c WHERE c.parent_enrollment_id = e.enrollment_id)`

// Aulas = ediciones de cursos, con las columnas de la vista Aulas y sus mismas
// exclusiones: aulas inactivas y segmento A5 (cancelados) no se listan.
export async function listClassrooms () {
  const { rows } = await pool.query(`
    SELECT pe.edition_num_id                                 AS edition_id,
           COALESCE(pe.global_code, pv.version_code)         AS code,
           pe.specific_code                                  AS edition,
           pv.abbreviation                                   AS course,
           pv.sessions,
           -- NULLIF: sin docente, CONCAT da ' ' (no NULL) y la pantalla mostraba vacio.
           NULLIF(TRIM(INITCAP(CONCAT(per.first_name, ' ', per.last_name))), '') AS instructor,
           -- Respaldo si Odoo no lo trae (withOdooData lo pisa con el del grupo
           -- de Odoo): correo personal y, si no hay, el usuario de Odoo.
           COALESCE(
             (SELECT pc.value FROM public.person_contacts pc
               WHERE pc.person_id = i.person_id AND pc.active = 'Y'
                 AND pc.cat_way_contact = (SELECT catalog_id FROM public.catalog WHERE alias = 'we_way_contact_email' LIMIT 1)
               ORDER BY pc.registration_date DESC LIMIT 1),
             CASE WHEN i.odoo_username LIKE '%@%' THEN i.odoo_username END
           )                                                 AS instructor_email,
           dayc.description                                  AS days,
           hourc.description                                 AS hours,
           p.odoo_activation,
           to_char(pe.start_date, 'YYYY-MM-DD')              AS start_date,
           to_char(pe.end_date, 'YYYY-MM-DD')                AS end_date
      FROM public.program_editions pe
      JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
      JOIN public.programs p          ON p.program_id = pv.program_id
      JOIN public.catalog cat         ON cat.catalog_id = p.cat_type_program
                                     AND cat.alias = 'we_program_type_course'
      LEFT JOIN public.catalog cota   ON cota.catalog_id = pe.cat_segment
      LEFT JOIN public.catalog dayc   ON dayc.catalog_id = pe.cat_day_combination_id
      LEFT JOIN public.catalog hourc  ON hourc.catalog_id = pe.cat_hour_combination_id
      LEFT JOIN public.instructors i  ON i.instructor_id = pe.instructor_id
      LEFT JOIN public.persons per    ON per.person_id = i.person_id
     WHERE pe.active = 'Y'
       AND COALESCE(cota.description, '') <> 'A5'
     ORDER BY pe.start_date DESC NULLS LAST, pe.edition_num_id DESC`)
  return rows
}

// Una fila liviana por alumno de todas las aulas: solo lo que hace falta para
// contar aprobados (~11k filas; nunca viajan al navegador).
export async function listGradeRows () {
  const { rows } = await pool.query(`
    SELECT e.program_edition_id AS edition_id,
           g.final_grade,
           (g.grade_id IS NOT NULL AND ${hasAnyGradeSql('g')}) AS has_grade
    ${STUDENTS_FROM}
     WHERE ${IS_STUDENT}`)
  return rows
}

export async function listClassroomStudents (editionId) {
  const { rows } = await pool.query(`
    SELECT e.enrollment_id,
           TRIM(concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS full_name,
           per.document_number,
           ${STUDENT_EMAIL_SQL} AS email,
           g.final_grade,
           (g.grade_id IS NOT NULL AND ${hasAnyGradeSql('g')}) AS has_grade
    ${STUDENTS_FROM}
      JOIN public.customers cust ON cust.customer_id = e.customer_id
      JOIN public.persons per    ON per.person_id = cust.person_id
      LEFT JOIN public.leads l   ON l.enrollment_id = e.enrollment_id
     WHERE e.program_edition_id = $1 AND ${IS_STUDENT}
     ORDER BY full_name`, [editionId])
  return rows
}

// Lo justo para ubicar el grupo de Odoo de un aula (activacion + inicio).
export async function getClassroomOdooKey (editionId) {
  const { rows } = await pool.query(`
    SELECT pe.edition_num_id AS edition_id, p.odoo_activation,
           to_char(pe.start_date, 'YYYY-MM-DD') AS start_date
      FROM public.program_editions pe
      JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
      JOIN public.programs p          ON p.program_id = pv.program_id
     WHERE pe.edition_num_id = $1`, [editionId])
  return rows[0] ?? null
}

// Retirados por aula, desde el ERP: Odoo BORRA al alumno del grupo al
// retirarlo (unenrollStudentFromCourse hace unlink), asi que alla no queda
// rastro. El REPROGRAMADO y el CAMBIO DE CURSO cuentan como retirados del aula
// en la que estaban (decision del usuario 26/10/26). El CC deja la fila origen
// en su aula con estado Cambio de curso; el RP tiene dos flujos en el ERP:
//  - actual: la fila origen se queda en su aula con estado Reprogramado.
//  - antiguo: la fila se movia a la nueva aula y el origen solo quedo en el
//    audit log (edition_reprogrammed, changes.old_edition_id).
// Misma regla que el historial del aula (classroomStudentsHistory): no cuenta
// a quien aun tiene otra matricula vigente en esa aula. Una persona = una salida.
const EXIT_ALIASES = [ALIAS.ENROLLMENT_STATUS_RETIRED, ALIAS.ENROLLMENT_STATUS_REPROGRAMMED, ALIAS.ENROLLMENT_STATUS_COURSE_CHANGED]

// Una fila por salida (aula, persona, inscripcion, motivo). $1 = EXIT_ALIASES.
// La usan el contador de la lista y el modal: misma regla en los dos.
const SALIDAS_SQL = `
  WITH salidas AS (
    SELECT e.program_edition_id AS edition_id, cust.person_id, e.enrollment_id, cts.alias AS reason
      FROM public.enrollments e
      JOIN public.catalog cts    ON cts.catalog_id = e.cat_type_status AND cts.alias = ANY($1)
      JOIN public.customers cust ON cust.customer_id = e.customer_id
     WHERE e.program_edition_id IS NOT NULL
    UNION
    SELECT (a.changes->>'old_edition_id')::int, cust.person_id, e.enrollment_id, '${ALIAS.ENROLLMENT_STATUS_REPROGRAMMED}'
      FROM public.enrollment_audit_log a
      JOIN public.enrollments e  ON e.enrollment_id = a.enrollment_id
      JOIN public.customers cust ON cust.customer_id = e.customer_id
     WHERE a.action = 'edition_reprogrammed'
       AND a.changes->>'old_edition_id' ~ '^[0-9]+$'
  )
  SELECT s.*
    FROM salidas s
   WHERE NOT EXISTS (
           SELECT 1
             FROM public.enrollments e2
             JOIN public.customers cu2 ON cu2.customer_id = e2.customer_id
             LEFT JOIN public.catalog c2 ON c2.catalog_id = e2.cat_type_status
            WHERE e2.program_edition_id = s.edition_id
              AND cu2.person_id = s.person_id
              AND e2.active = 'Y'
              AND e2.enrollment_id <> s.enrollment_id
              AND (c2.alias IS NULL OR c2.alias <> ALL($1)))`

export async function listRetiredCounts () {
  const { rows } = await pool.query(`
    SELECT edition_id, COUNT(DISTINCT person_id)::int AS retired
      FROM (${SALIDAS_SQL}) x
     GROUP BY edition_id`, [EXIT_ALIASES])
  return new Map(rows.map(r => [r.edition_id, r.retired]))
}

// Los que salieron de UN aula, para listarlos en rojo en el modal. Una fila por
// persona (la inscripcion mas reciente si salio mas de una vez).
export async function listClassroomDepartures (editionId) {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (x.person_id)
           x.enrollment_id, x.reason,
           TRIM(concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS full_name,
           per.document_number,
           ${STUDENT_EMAIL_SQL} AS email
      FROM (${SALIDAS_SQL}) x
      JOIN public.enrollments e  ON e.enrollment_id = x.enrollment_id
      JOIN public.customers cust ON cust.customer_id = e.customer_id
      JOIN public.persons per    ON per.person_id = cust.person_id
      LEFT JOIN public.leads l   ON l.enrollment_id = e.enrollment_id
     WHERE x.edition_id = $2
     ORDER BY x.person_id, x.enrollment_id DESC`, [EXIT_ALIASES, editionId])
  return rows.sort((a, b) => a.full_name.localeCompare(b.full_name))
}
