import pg from 'pg'
let c
for (let i = 1; ; i++) {
  c = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 })
  try { await c.connect(); break } catch (err) {
    await c.end().catch(() => {})
    if (i >= 60) throw err
    await new Promise(r => setTimeout(r, 4000))
  }
}
const t = (l, r) => { console.log('\n--- ' + l + ' ---'); console.table(r) }
console.log('db =', (await c.query('select current_database() d')).rows[0].d)
t('plan de pago de HIJOS importados (masiva FICO)', (await c.query(
  `SELECT h.cat_payment_plan, count(*) FROM enrollments h
    WHERE h.parent_enrollment_id IS NOT NULL AND coalesce(h.notes,'') LIKE '%masiva FICO%'
    GROUP BY 1 ORDER BY 2 DESC`)).rows)
t('plan de pago de TODOS los hijos', (await c.query(
  `SELECT cat_payment_plan, count(*) FROM enrollments WHERE parent_enrollment_id IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`)).rows)
t('estado cuota 0 en importados', (await c.query(
  `SELECT pi.cat_status, count(*) FROM payment_installments pi
     JOIN enrollments e ON e.enrollment_id=pi.enrollment_id
    WHERE pi.installment_number=0 AND coalesce(e.notes,'') LIKE '%masiva FICO%' GROUP BY 1 ORDER BY 2 DESC`)).rows)
t('imports previos de una fila (Pinto / Marin)', (await c.query(
  `SELECT e.enrollment_id, p.document_number, e.registration_date::date reg, e.list_price, e.discount_amount,
          e.total_amount, e.cat_payment_plan, e.cat_type_status,
          (SELECT count(*) FROM enrollment_discounts ed WHERE ed.enrollment_id=e.enrollment_id) dsctos
     FROM enrollments e JOIN customers cu ON cu.customer_id=e.customer_id JOIN persons p ON p.person_id=cu.person_id
    WHERE p.document_number IN ('99000015','45805891') AND e.parent_enrollment_id IS NULL
    ORDER BY e.enrollment_id DESC LIMIT 10`)).rows)
t('edicion BI-DZ-02 E31', (await c.query(
  `SELECT pe.edition_num_id, pe.global_code, pe.start_date::date, pe.active, pv.version_code, pv.program_version_id
     FROM program_editions pe JOIN program_versions pv ON pv.program_version_id=pe.program_version_id
    WHERE pv.version_code='BI-DZ-02' AND pe.global_code='E31'`)).rows)
t('aulas hijas de esa edicion', (await c.query(
  `SELECT es.*, pv.version_code FROM edition_structure es
     JOIN program_editions pe ON pe.edition_num_id=es.child_edition_id
     JOIN program_versions pv ON pv.program_version_id=pe.program_version_id
    WHERE es.parent_edition_id=(SELECT pe2.edition_num_id FROM program_editions pe2
       JOIN program_versions pv2 ON pv2.program_version_id=pe2.program_version_id
      WHERE pv2.version_code='BI-DZ-02' AND pe2.global_code='E31')`)).rows)
t('precio catalogo BI-DZ-02', (await c.query(
  `SELECT pp.program_version_id, pp.cat_currency_id, pp.cat_profile_id, pp.list_price, pp.active
     FROM program_pricing pp JOIN program_versions pv ON pv.program_version_id=pp.program_version_id
    WHERE pv.version_code='BI-DZ-02'`)).rows)
await c.end()
