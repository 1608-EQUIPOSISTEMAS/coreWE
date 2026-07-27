// Diagnóstico one-off: tokens de pago de erickgarciamend@gmail.com (RICK ANDERSON GARCIA MENDOZA)
// y qué cuelga del token de S/100 (enrollment, pagos, cuotas, lead).
import { q, pool } from './db.mjs'

const EMAIL = 'erickgarciamend@gmail.com'

const { rows: toks } = await q(`
  SELECT t.token_id, t.group_id, t.amount, t.currency, t.status, t.payment_type,
         t.enrollment_id, t.lead_id, t.provider_reference, t.created_at, t.updated_at,
         t.inscription_data->>'email' AS email_insc
    FROM payment_tokens t
   WHERE t.inscription_data::text ILIKE $1
      OR t.lead_id IN (SELECT lead_id FROM leads WHERE origin_email ILIKE $2)
   ORDER BY t.created_at`, [`%${EMAIL}%`, EMAIL])
console.log('--- payment_tokens ---')
console.table(toks)

const enrIds = [...new Set(toks.map(t => t.enrollment_id).filter(Boolean))]
const leadIds = [...new Set(toks.map(t => t.lead_id).filter(Boolean))]
console.log('enrollments:', enrIds, 'leads:', leadIds)

if (enrIds.length) {
  const { rows: enr } = await q(`
    SELECT e.enrollment_id, e.parent_enrollment_id, e.total_amount, e.cat_fico_status,
           e.active, e.customer_id, e.registration_date::date, pe.specific_code,
           pe.start_date::date AS inicio, p.program_name
      FROM enrollments e
      LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      LEFT JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
      LEFT JOIN programs p ON p.program_id = pv.program_id
     WHERE e.enrollment_id = ANY($1::int[]) OR e.parent_enrollment_id = ANY($1::int[])
     ORDER BY e.enrollment_id`, [enrIds])
  console.log('--- enrollments ligados ---')
  console.table(enr)

  const todos = enr.map(e => e.enrollment_id)
  const { rows: pays } = await q(
    `SELECT payment_id, enrollment_id, amount, payment_date::date, transaction_code, active
       FROM payments WHERE enrollment_id = ANY($1::int[]) ORDER BY payment_id`, [todos])
  console.log('--- payments ---'); console.table(pays)
  const { rows: cuo } = await q(
    `SELECT installment_id, enrollment_id, installment_number, amount, due_date::date, cat_status
       FROM payment_installments WHERE enrollment_id = ANY($1::int[]) ORDER BY installment_id`, [todos])
  console.log('--- payment_installments ---'); console.table(cuo)
}

const { rows: lds } = await q(
  `SELECT lead_id, full_name, origin_email, origin_phone, pay_date::date, cat_status_lead,
          enrollment_id, program_edition_id, agreed_amount, active
     FROM leads WHERE origin_email ILIKE $1 OR lead_id = ANY($2::int[]) ORDER BY lead_id`,
  [EMAIL, leadIds])
console.log('--- leads ---'); console.table(lds)
await pool.end()
