import pg from 'pg'
// El tunel SSH se cae seguido: reintentar la conexion.
let c
for (let i = 1; ; i++) {
  c = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 })
  try { await c.connect(); break } catch (err) {
    await c.end().catch(() => {})
    if (i >= 40) throw err
    console.error(`[tunel] ${err.message} - reintento ${i}`)
    await new Promise(r => setTimeout(r, 5000))
  }
}
const EID = Number(process.argv[2])
const t = (l, r) => { console.log('\n--- ' + l + ' ---'); console.table(r) }
console.log('db =', (await c.query('select current_database() d')).rows[0].d)
t('cabecera', (await c.query(
  `SELECT e.enrollment_id, e.parent_enrollment_id, e.program_version_id pv, e.program_edition_id pe,
          e.cat_type_status, e.cat_fico_status, e.cat_payment_plan, e.cat_currency, e.cat_profile_id,
          e.list_price, e.discount_amount, e.total_amount, e.seller_agent_id, e.agent_origin,
          e.registration_date::date reg, e.notes
     FROM enrollments e WHERE e.enrollment_id=$1`, [EID])).rows)
t('persona', (await c.query(
  `SELECT p.person_id, p.document_number, p.first_name, p.last_name, cu.customer_id,
          (SELECT string_agg(pc.value,' | ') FROM person_contacts pc WHERE pc.person_id=p.person_id) contactos
     FROM enrollments e JOIN customers cu ON cu.customer_id=e.customer_id JOIN persons p ON p.person_id=cu.person_id
    WHERE e.enrollment_id=$1`, [EID])).rows)
t('hijos', (await c.query(
  `SELECT h.enrollment_id, h.cat_type_status, h.cat_payment_plan, h.total_amount, h.program_edition_id,
          pv.version_code, pe.global_code
     FROM enrollments h JOIN program_editions pe ON pe.edition_num_id=h.program_edition_id
     JOIN program_versions pv ON pv.program_version_id=h.program_version_id
    WHERE h.parent_enrollment_id=$1 ORDER BY h.enrollment_id`, [EID])).rows)
t('cuotas', (await c.query(
  `SELECT installment_number n, amount, due_date::date, cat_status FROM payment_installments
    WHERE enrollment_id=$1 ORDER BY installment_number`, [EID])).rows)
t('pagos', (await c.query(
  `SELECT payment_id, installment_id, amount, payment_date::date, transaction_code, cat_method_payment medio,
          cat_payment_type tipo, cat_settlement_status liq, settled_in_account_id cuenta
     FROM payments WHERE enrollment_id=$1 ORDER BY payment_id`, [EID])).rows)
t('descuentos', (await c.query(
  `SELECT ed.discount_id, d.description, ed.calculated_amount FROM enrollment_discounts ed
     JOIN discounts d ON d.discount_id=ed.discount_id WHERE ed.enrollment_id=$1`, [EID])).rows)
t('sanity', (await c.query(
  `SELECT e.total_amount, (SELECT sum(amount) FROM payment_installments WHERE enrollment_id=e.enrollment_id) suma_cuotas,
          (SELECT sum(amount) FROM payments WHERE enrollment_id=e.enrollment_id AND active='Y') suma_pagos,
          (SELECT sum(amount) FROM payment_installments WHERE enrollment_id=e.enrollment_id AND cat_status IN (4454,2471)) pagado
     FROM enrollments e WHERE e.enrollment_id=$1`, [EID])).rows)
t('audit', (await c.query(
  `SELECT audit_id, action, performed_by, performed_at::timestamp(0) FROM enrollment_audit_log
    WHERE enrollment_id=$1 ORDER BY audit_id`, [EID])).rows)
const mv = await c.query(`SELECT * FROM mv_enrollment_report_system WHERE "ID"=$1`, [EID])
console.log('\n--- fila MV ---')
if (!mv.rows.length) console.log('(no esta en la MV)')
else for (const [k, v] of Object.entries(mv.rows[0])) if (v !== null && v !== '') console.log(' ', k, '=', v)
await c.end()
