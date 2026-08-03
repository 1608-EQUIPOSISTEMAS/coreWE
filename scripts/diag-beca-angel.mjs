// Diagnóstico: por qué angelsgabrielr97@gmail.com sale como BECA en el aula
// si es socio WE BLACK. Revisa persona(s), membresías y la inscripción del aula.
import { q, pool } from './db.mjs'

const EMAIL = process.argv[2] || 'angelsgabrielr97@gmail.com'

const show = (t, rows) => { console.log(`\n=== ${t} ===`); console.table(rows) }

try {
  const { rows: personas } = await q(`
    SELECT DISTINCT per.person_id, per.document_number AS dni,
           TRIM(concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS nombre,
           pc.value AS email
      FROM public.persons per
      JOIN public.person_contacts pc ON pc.person_id = per.person_id
      JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact
     WHERE lower(pc.value) = lower($1)
  `, [EMAIL])
  show('PERSONAS con ese correo', personas)

  const ids = personas.map(p => p.person_id)
  if (!ids.length) { console.log('sin persona con ese correo'); process.exit(0) }

  const { rows: insc } = await q(`
    SELECT e.enrollment_id, cust.person_id, pr.program_name, pr.is_membership,
           pv.abbreviation AS tier, e.total_amount, e.active,
           cf.alias AS fico_status, cts.alias AS type_status,
           e.parent_enrollment_id, e.program_edition_id, e.membership_program_id,
           e.registration_date::date AS fecha
      FROM public.enrollments e
      JOIN public.customers cust ON cust.customer_id = e.customer_id
      JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
      JOIN public.programs pr ON pr.program_id = pv.program_id
      JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
 LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
     WHERE cust.person_id = ANY($1::int[])
     ORDER BY e.enrollment_id
  `, [ids])
  show('INSCRIPCIONES de la(s) persona(s)', insc)

  // Réplica exacta del LATERAL mem de classroomStudentsList
  const { rows: mem } = await q(`
    SELECT per.person_id, (
      SELECT pv_m.abbreviation
        FROM public.enrollments em
        JOIN public.customers c_m ON c_m.customer_id = em.customer_id
        JOIN public.program_versions pv_m ON pv_m.program_version_id = em.program_version_id
        JOIN public.programs prog_m ON prog_m.program_id = pv_m.program_id AND prog_m.is_membership = true
        JOIN public."catalog" cf_m ON cf_m.catalog_id = em.cat_fico_status
       WHERE c_m.person_id = per.person_id AND em.active = 'Y'
         AND cf_m.alias = 'we_enrollment_status_checked'
       ORDER BY em.enrollment_id DESC LIMIT 1) AS tier_name
      FROM public.persons per WHERE per.person_id = ANY($1::int[])
  `, [ids])
  show('mem.tier_name (criterio del aula)', mem)
} finally {
  await pool.end()
}
