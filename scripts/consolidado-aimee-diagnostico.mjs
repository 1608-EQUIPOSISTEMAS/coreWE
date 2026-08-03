// One-off: cómo quedó registrada la CONSOLIDACIÓN de AIMEE TRUJILLO (ESP 14027).
// Es la única de los 6 padres del ESPEC. SAP LOG. INTEGRAL (ED 15625) sin hijo en
// SAP HANA MM (ED 15626) => por eso el aula cuenta 25 y no 26. Busca:
//   1. el árbol completo de su ESP,
//   2. TODAS las inscripciones de esa persona (¿llevó SAP HANA MM antes?),
//   3. las notas del padre y el audit log, a ver si la consolidación se anotó.
import { q, pool } from './db.mjs'

const PADRE = 14027

const persona = await q(`
  SELECT cu.person_id, p.first_name, p.last_name, p.mother_last_name, p.document_number
    FROM public.enrollments e
    JOIN public.customers cu ON cu.customer_id = e.customer_id
    JOIN public.persons p    ON p.person_id    = cu.person_id
   WHERE e.enrollment_id = $1`, [PADRE])
console.log('== Persona ==')
console.table(persona.rows)
const personId = persona.rows[0]?.person_id

console.log('\n== Árbol del ESP 14027 (hijos) ==')
console.table((await q(`
  SELECT e.enrollment_id, e.program_edition_id AS ed, pe.specific_code, pr.program_name,
         e.active, cts.alias AS type_status, e.total_amount, e.notes
    FROM public.enrollments e
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.programs pr         ON pr.program_id = pv.program_id
    LEFT JOIN public."catalog" cts       ON cts.catalog_id = e.cat_type_status
   WHERE e.parent_enrollment_id = $1
   ORDER BY pe.start_date NULLS LAST, e.enrollment_id`, [PADRE])).rows)

console.log('\n== TODAS las inscripciones de la persona ==')
console.table((await q(`
  SELECT e.enrollment_id, e.parent_enrollment_id AS padre, e.program_edition_id AS ed,
         pe.specific_code, pr.program_name, pe.start_date, pe.end_date,
         e.active, cf.alias AS fico, cts.alias AS type_status, e.total_amount
    FROM public.enrollments e
    JOIN public.customers cu ON cu.customer_id = e.customer_id
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.programs pr         ON pr.program_id = pv.program_id
    LEFT JOIN public."catalog" cf        ON cf.catalog_id = e.cat_fico_status
    LEFT JOIN public."catalog" cts       ON cts.catalog_id = e.cat_type_status
   WHERE cu.person_id = $1
   ORDER BY pe.start_date NULLS FIRST, e.enrollment_id`, [personId])).rows)

console.log('\n== Notas del padre 14027 ==')
console.log((await q('SELECT notes FROM public.enrollments WHERE enrollment_id=$1', [PADRE])).rows[0])

console.log('\n== Audit log del padre y de sus hijos ==')
console.table((await q(`
  SELECT a.enrollment_id, a.action, a.performed_at, a.justificacion, u.alias AS por
    FROM public.enrollment_audit_log a
    LEFT JOIN public.users u ON u.user_id = a.performed_by
   WHERE a.enrollment_id = $1
      OR a.enrollment_id IN (SELECT enrollment_id FROM public.enrollments WHERE parent_enrollment_id = $1)
   ORDER BY a.performed_at`, [PADRE])).rows)

// ¿Existe en la BD alguna inscripción de SAP HANA MM (cualquier edición) de ella?
console.log('\n== Ediciones de SAP HANA MM en la BD ==')
console.table((await q(`
  SELECT pe.edition_num_id, pe.specific_code, pr.program_name, pe.start_date, pe.end_date
    FROM public.program_editions pe
    JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN public.programs pr         ON pr.program_id = pv.program_id
   WHERE pr.program_name ILIKE '%HANA MM%'
   ORDER BY pe.start_date`)).rows)

await pool.end()
