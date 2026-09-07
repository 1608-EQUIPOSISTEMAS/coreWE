import { q, pool } from './db.mjs'

console.log('=== personas por documento exacto ===')
console.table((await q(`
  select p.person_id, p.document_number, p.first_name, p.last_name, p.active, c.customer_id
  from persons p left join customers c on c.person_id=p.person_id
  where p.document_number in ('75462134','78451212','73117361')`)).rows)

console.log('\n=== personas por nombre (jauregui / alpas / cabello) ===')
console.table((await q(`
  select p.person_id, p.document_number, p.first_name, p.last_name, p.active, c.customer_id
  from persons p left join customers c on c.person_id=p.person_id
  where p.first_name||' '||coalesce(p.last_name,'') ilike any (array['%JAUREGUI%','%J_UREGUI%','%ALPAS%','%CABELLO RIVADENEYRA%','%MARICIELO%'])`)).rows)

console.log('\n=== person_contacts cols ===')
console.log((await q(`select column_name from information_schema.columns where table_name='person_contacts' order by ordinal_position`)).rows.map(r=>r.column_name).join(', '))

console.log('\n=== contactos por email de los 3 ===')
console.table((await q(`
  select * from person_contacts
  where value ilike any (array['%maricielojaurepe%','%juan.alpas2507%','%ricabellori0798%','946182072','955487111','956245597'])`)).rows)

console.log('\n=== contactos de la persona 19152 ===')
console.table((await q(`select * from person_contacts where person_id=19152`)).rows)

console.log('\n=== TODAS las inscripciones del customer 17927 ===')
console.table((await q(`
  select e.enrollment_id, e.program_edition_id, e.program_version_id, e.total_amount, e.registration_date::date reg,
         e.odoo_user_id, e.odoo_student_id, e.odoo_email, e.active, e.parent_enrollment_id,
         pv.name_program
  from enrollments e
  left join program_versions pv on pv.program_version_id=e.program_version_id
  where e.customer_id=17927 order by e.enrollment_id`)).rows)

await pool.end()
