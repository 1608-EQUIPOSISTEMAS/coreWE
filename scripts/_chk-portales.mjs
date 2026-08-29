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
const DOC = '73276521'; const MAIL = 'ca.portales@hotmail.com'
console.log('db =', (await c.query('select current_database() d')).rows[0].d)
console.log('PERSONAS por doc/nombre:', (await c.query(
  `SELECT person_id, document_number, first_name, last_name, mother_last_name, active
     FROM persons WHERE document_number=$1 OR (upper(last_name) LIKE '%PORTALES%' AND upper(first_name) LIKE '%CESAR%')`, [DOC])).rows)
console.log('PERSONAS por correo:', (await c.query(
  `SELECT pc.person_id, pc.value, p.document_number, p.first_name, p.last_name
     FROM person_contacts pc JOIN persons p ON p.person_id=pc.person_id
    WHERE lower(pc.value)=lower($1)`, [MAIL])).rows)
console.log('ENROLLMENTS:', (await c.query(
  `SELECT e.enrollment_id, e.program_version_id, e.program_edition_id, e.parent_enrollment_id,
          e.total_amount, e.cat_type_status, e.registration_date, left(coalesce(e.notes,''),60) notes
     FROM enrollments e JOIN customers cu ON cu.customer_id=e.customer_id JOIN persons p ON p.person_id=cu.person_id
    WHERE p.document_number=$1 ORDER BY e.enrollment_id`, [DOC])).rows)
console.log('ASESOR AE30:', (await c.query("SELECT user_id, alias, name FROM users WHERE upper(alias)='AE30'")).rows)
console.log('EDICIONES BI-DZ-02:', (await c.query(
  `SELECT pe.edition_num_id, pe.global_code, pv.version_code, pe.active
     FROM program_editions pe JOIN program_versions pv ON pv.program_version_id=pe.program_version_id
    WHERE pv.version_code='BI-DZ-02' ORDER BY pe.edition_num_id`)).rows)
console.log('CUENTAS 6/12:', (await c.query('SELECT * FROM bank_accounts WHERE account_id IN (6,12)')).rows)
await c.end()
