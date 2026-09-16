// Diagnóstico: la inscripción de miguelbellido076@gmail.com sale en S/100 en la
// hoja "7. Convenios" cuando el convenio es de S/250 (RP: inicial 100 + cuota 150).
//
// La hoja arma MONTO con SUM(payment_installments.amount) del enrollment, así que
// una RP parte la venta en dos filas: origen (lo pagado) y destino (lo pendiente).
import { q, pool } from './db.mjs'

const EMAIL = 'miguelbellido076@gmail.com'

const { rows: [{ db }] } = await q('SELECT current_database() AS db')
console.log('BD:', db)

const { rows: enr } = await q(
  `SELECT e.enrollment_id, e.parent_enrollment_id, e.active,
          cts.alias        AS estado_alumno,
          cf.alias         AS fico,
          cp.alias         AS plan,
          pv.abbreviation  AS programa,
          e.program_edition_id, pe.start_date,
          e.list_price, e.discount_amount, e.total_amount,
          e.agent_origin, e.b2b_contract_id, e.registration_date, e.notes
     FROM public.enrollments e
     JOIN public.customers cust ON cust.customer_id = e.customer_id
     JOIN public.persons per    ON per.person_id = cust.person_id
     LEFT JOIN public.leads l             ON l.enrollment_id = e.enrollment_id
     LEFT JOIN public."catalog" cts       ON cts.catalog_id = e.cat_type_status
     LEFT JOIN public."catalog" cf        ON cf.catalog_id = e.cat_fico_status
     LEFT JOIN public."catalog" cp        ON cp.catalog_id = e.cat_payment_plan
     LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
     LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    WHERE lower(COALESCE(l.origin_email, '')) = $1
       OR EXISTS (SELECT 1 FROM public.person_contacts pc
                   WHERE pc.person_id = per.person_id AND lower(pc.value) = $1)
    ORDER BY e.enrollment_id`,
  [EMAIL]
)
console.log('== ENROLLMENTS ==')
console.table(enr)

const ids = enr.map((r) => r.enrollment_id)
if (!ids.length) { console.log('sin datos'); await pool.end(); process.exit(0) }

const { rows: cuotas } = await q(
  `SELECT pi.installment_id, pi.enrollment_id, pi.installment_number, pi.amount,
          pi.due_date, c.alias AS estado, pi.notes
     FROM public.payment_installments pi
     LEFT JOIN public."catalog" c ON c.catalog_id = pi.cat_status
    WHERE pi.enrollment_id = ANY($1)
    ORDER BY pi.enrollment_id, pi.installment_number`,
  [ids]
)
console.log('== CUOTAS ==')
console.table(cuotas)

const { rows: pagos } = await q(
  `SELECT p.payment_id, p.enrollment_id, p.installment_id, p.amount, p.payment_date,
          ct.alias AS tipo, cs.alias AS liquidacion, p.active
     FROM public.payments p
     LEFT JOIN public."catalog" ct ON ct.catalog_id = p.cat_payment_type
     LEFT JOIN public."catalog" cs ON cs.catalog_id = p.cat_settlement_status
    WHERE p.enrollment_id = ANY($1)
    ORDER BY p.enrollment_id, p.payment_date, p.payment_id`,
  [ids]
)
console.log('== PAGOS ==')
console.table(pagos)

const { rows: leads } = await q(
  `SELECT l.lead_id, l.enrollment_id, l.origin_email, l.pay_date, l.b2b, l.company_id
     FROM public.leads l WHERE l.enrollment_id = ANY($1)`,
  [ids]
)
console.log('== LEADS ==')
console.table(leads)

try {
  const { rows: audit } = await q(
    `SELECT created_at, action, entity, entity_id, details
       FROM public.audit_logs
      WHERE entity_id::text = ANY($1)
      ORDER BY created_at DESC LIMIT 30`,
    [ids.map(String)]
  )
  console.log('== AUDIT ==')
  for (const a of audit) {
    console.log(a.created_at, a.entity, a.entity_id, a.action, JSON.stringify(a.details)?.slice(0, 300))
  }
} catch (e) {
  console.log('== AUDIT no leído:', e.message)
}

await pool.end()
