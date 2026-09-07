// ¿Los padres sin hijos golpean al cronograma de septiembre en adelante?
//
// Un padre sin hijos no tiene edicion, asi que no hay fecha que mirar: hay que
// inferir a que cohorte deberia ir. Se busca, por cada modulo del paquete
// comprado, la edicion ACTIVA mas proxima que empiece de la fecha de corte en
// adelante. Ese es el aula donde el alumno deberia estar contado y no lo esta.
import { q, pool } from './prod-db.mjs'

const DESDE = process.argv[2] || '2026-09-01'

const { rows } = await q(`
  WITH huerfanos AS (
    SELECT e.enrollment_id, e.customer_id, pv.program_version_id AS paquete_pv,
           pv.abbreviation AS paquete
      FROM enrollments e
      JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      JOIN catalog cf ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
      LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
     WHERE e.active = 'Y' AND e.program_edition_id IS NULL
       AND EXISTS (SELECT 1 FROM program_version_structure s
                    WHERE s.parent_program_version_id = pv.program_version_id)
       AND NOT EXISTS (SELECT 1 FROM enrollments h
                        WHERE h.parent_enrollment_id = e.enrollment_id AND h.active = 'Y')
       AND (cts.alias IS NULL OR cts.alias NOT IN (
              'we_enrollment_status_retired','we_enrollment_status_course_changed',
              'we_enrollment_status_reprogrammed'))
       -- fuera los que igual entraron al aula por una inscripcion suelta
       AND NOT EXISTS (
         SELECT 1 FROM enrollments o
           JOIN customers co ON co.customer_id = o.customer_id
           JOIN customers ch ON ch.customer_id = e.customer_id AND ch.person_id = co.person_id
           JOIN catalog cfo ON cfo.catalog_id = o.cat_fico_status AND cfo.alias = 'we_enrollment_status_checked'
           JOIN program_version_structure s2 ON s2.parent_program_version_id = pv.program_version_id
                                            AND s2.child_program_version_id = o.program_version_id
          WHERE o.active = 'Y' AND o.program_edition_id IS NOT NULL)
  ),
  destino AS (
    SELECT h.enrollment_id, mv.abbreviation AS modulo, pe.specific_code, pe.start_date::date AS inicio,
           pe.edition_num_id
      FROM huerfanos h
      JOIN program_version_structure s ON s.parent_program_version_id = h.paquete_pv
      JOIN program_versions mv ON mv.program_version_id = s.child_program_version_id
      JOIN LATERAL (
        SELECT pe2.edition_num_id, pe2.specific_code, pe2.start_date
          FROM program_editions pe2
         WHERE pe2.program_version_id = mv.program_version_id
           AND pe2.active = 'Y' AND pe2.start_date >= $1::date
         ORDER BY pe2.start_date ASC LIMIT 1
      ) pe ON TRUE
  )
  SELECT modulo, specific_code AS edicion, inicio, COUNT(*)::int AS alumnos_no_contados
    FROM destino
   GROUP BY modulo, specific_code, inicio, edition_num_id
   ORDER BY inicio, alumnos_no_contados DESC`, [DESDE])

console.log(`Aulas que arrancan desde ${DESDE} donde faltaria contar alumnos:`)
console.table(rows)
console.log('Total de plazas no contadas:', rows.reduce((n, r) => n + r.alumnos_no_contados, 0))

await pool.end()
