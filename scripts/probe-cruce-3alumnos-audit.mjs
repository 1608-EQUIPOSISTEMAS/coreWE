import { q, pool } from './db.mjs'
const { rows } = await q(`
  select id, table_name, record_id, action, user_id, changed_fields, created_at, old_data, new_data
  from audit_logs
  where (table_name='enrollments' and record_id in (13525,18018,13447,13547))
     or (table_name='persons' and record_id=19152)
     or (table_name='customers' and record_id=17927)
     or (table_name='person_contacts' and record_id in (23871,23889,23919,81854,81855,23872,23890,23920))
  order by created_at, id`)
console.log('n=', rows.length)
for (const r of rows) {
  console.log(`\n[${r.id}] ${r.created_at.toISOString()} ${r.table_name}#${r.record_id} ${r.action} user=${r.user_id} fields=${JSON.stringify(r.changed_fields)}`)
  const interes = ['customer_id','odoo_email','odoo_user_id','odoo_student_id','first_name','last_name','document_number','value','person_id','program_edition_id']
  const pick = o => o ? Object.fromEntries(Object.entries(o).filter(([k]) => interes.includes(k))) : null
  const o = pick(r.old_data), n = pick(r.new_data)
  if (o && Object.keys(o).length) console.log('   old:', JSON.stringify(o))
  if (n && Object.keys(n).length) console.log('   new:', JSON.stringify(n))
}
await pool.end()
