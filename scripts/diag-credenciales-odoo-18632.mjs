// Diagnóstico de un caso puntual: la inscripción envió credenciales sintéticas
// (@weeducacion.edu.pe) pero el usuario no aparece en Odoo. Solo lectura.
//   node scripts/diag-credenciales-odoo-18632.mjs [enrollment_id]
import { q, pool } from './prod-db.mjs'

const ID = Number(process.argv[2] || 18632)

const { rows: enr } = await q(`
  SELECT e.enrollment_id, e.parent_enrollment_id, e.customer_id,
         e.program_edition_id, e.odoo_email, e.odoo_user_id, e.odoo_student_id,
         e.odoo_order_id, e.cat_type_status, e.cat_fico_status, e.flag_send,
         e.registration_date, e.active, left(coalesce(e.notes,''), 300) AS notes,
         p.person_id, p.first_name, p.last_name, p.mother_last_name,
         p.document_number, pe.specific_code AS edicion, pr.program_name AS programa
    FROM enrollments e
    JOIN customers c ON c.customer_id = e.customer_id
    JOIN persons   p ON p.person_id   = c.person_id
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
    LEFT JOIN programs pr ON pr.program_id = pv.program_id
   WHERE e.enrollment_id = $1`, [ID])

console.log('=== ENROLLMENT', ID, '===')
console.log(JSON.stringify(enr, null, 2))
if (!enr.length) { await pool.end(); process.exit(0) }

const { person_id: personId, document_number: doc, odoo_email: odooEmail } = enr[0]

const { rows: lead } = await q(`
  SELECT lead_id, enrollment_id, person_id, full_name, origin_email, web,
         cat_channel, registration_date
    FROM leads WHERE enrollment_id = $1 OR person_id = $2
   ORDER BY lead_id`, [ID, personId])
console.log('\n=== LEAD(S) ===')
console.table(lead)

const { rows: correos } = await q(`
  SELECT email_log_id, to_email, subject, template_type, status, sent_at
    FROM email_logs WHERE enrollment_id = $1 ORDER BY sent_at`, [ID])
console.log('\n=== CORREOS ENVIADOS ===')
console.table(correos)

// Historial: revela si ya tenía un login Odoo anterior distinto del enviado.
const { rows: hist } = await q(`
  SELECT e.enrollment_id, e.registration_date, e.odoo_email, e.odoo_user_id,
         e.odoo_student_id, e.cat_type_status, e.parent_enrollment_id,
         pr.program_name AS programa
    FROM enrollments e
    JOIN customers c ON c.customer_id = e.customer_id
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
    LEFT JOIN programs pr ON pr.program_id = pv.program_id
   WHERE c.person_id = $1
   ORDER BY e.enrollment_id`, [personId])
console.log('\n=== HISTORIAL DE LA PERSONA', personId, '===')
console.table(hist)

// ¿Ese odoo_email lo usa alguien más? (colisión de apellido.nombre)
const { rows: mismoLogin } = await q(`
  SELECT e.enrollment_id, e.odoo_user_id, e.registration_date,
         p.person_id, p.first_name, p.last_name, p.document_number
    FROM enrollments e
    JOIN customers c ON c.customer_id = e.customer_id
    JOIN persons   p ON p.person_id   = c.person_id
   WHERE lower(e.odoo_email) = lower($1)
   ORDER BY e.enrollment_id`, [odooEmail])
console.log('\n=== QUIÉN MÁS TIENE EL LOGIN', odooEmail, '===')
console.table(mismoLogin)

const { rows: personas } = await q(`
  SELECT person_id, first_name, last_name, mother_last_name, document_number,
         registration_date
    FROM persons WHERE document_number = $1 ORDER BY person_id`, [doc || ''])
console.log('\n=== PERSONAS CON EL MISMO DOCUMENTO ===')
console.table(personas)

const { rows: hijos } = await q(`
  SELECT enrollment_id, program_edition_id, odoo_email, odoo_user_id,
         odoo_student_id, cat_type_status
    FROM enrollments WHERE parent_enrollment_id = $1 ORDER BY enrollment_id`, [ID])
console.log('\n=== HIJOS DE', ID, '===')
console.table(hijos)

await pool.end()
