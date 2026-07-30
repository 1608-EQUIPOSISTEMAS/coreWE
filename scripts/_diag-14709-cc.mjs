// Diagnostico CC 14596 -> 14709 (CARLOTA AZUCENA FLORES HUAMAN).
// Solo LECTURA. Reproduce el hallazgo: el destino quedo colgado de un
// person/customer DUPLICADO creado por el propio CC, porque el SP
// register_direct hace lookup de persona SOLO por document_number y esta
// alumna no tiene DNI.
import 'dotenv/config'
import pg from 'pg'
const m = (process.env.DATABASE_URL || '').match(/^postgresql:\/\/([^:]+):([^@]+)@/)
const pw = process.env.PGPASSWORD || decodeURIComponent(m[2])
const c = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'neondb', user: 'postgres', password: pw, connectionTimeoutMillis: 10000 })
await c.connect()
const show = async (label, sql, params = []) => {
  try { const r = await c.query(sql, params); console.log('\n=== ' + label + ' (' + r.rowCount + ') ==='); console.table(r.rows) } catch (e) { console.log('\n=== ' + label + ' ERROR: ' + e.message) }
}

await show('1. ORIGEN 14596 y DESTINO 14709', `
  select e.enrollment_id, e.customer_id, cu.person_id, e.program_version_id, pv.version_code, pv.description programa,
         e.program_edition_id, e.total_amount, e.cat_type_status, e.cat_payment_plan, e.parent_enrollment_id,
         e.odoo_user_id, e.odoo_student_id, e.odoo_email, e.registration_date
  from enrollments e join customers cu on cu.customer_id=e.customer_id
  left join program_versions pv on pv.program_version_id=e.program_version_id
  where e.enrollment_id in (14596,14709) order by e.enrollment_id`)

await show('2. Las DOS personas (duplicado)', `
  select p.person_id, p.first_name, p.last_name, p.document_number, p.active, p.registration_date,
         (select string_agg(customer_id::text,',') from customers cu where cu.person_id=p.person_id) customers,
         (select string_agg(pc.value,' | ') from person_contacts pc where pc.person_id=p.person_id) contactos
  from persons p where p.person_id in (19573,19629) order by p.person_id`)

await show('3. course_changes (apunta al customer ORIGINAL 18331)', 'select * from course_changes where enrollment_destination_id=14709')

await show('4. Que cuelga del duplicado (person 19629 / customer 18387)', `
  select 'enrollments' tabla, count(*) n from enrollments where customer_id=18387
  union all select 'course_changes', count(*) from course_changes where customer_id=18387
  union all select 'leads', count(*) from leads where person_id=19629
  union all select 'person_contacts', count(*) from person_contacts where person_id=19629
  union all select 'users', count(*) from users where person_id=19629
  union all select 'instructors', count(*) from instructors where person_id=19629`)

await show('5. Hijos SEG del destino (deberian ser 3: SQL/PYTHON/POWER BI)', 'select enrollment_id from enrollments where parent_enrollment_id=14709')

await show('6. Estructura del destino (pv 125 = paquete de 3 modulos)', `
  select pvs.child_program_version_id, pvs.sort_order, pv.description,
         (select count(*) from program_editions pe where pe.program_version_id=pvs.child_program_version_id) ediciones
  from program_version_structure pvs join program_versions pv on pv.program_version_id=pvs.child_program_version_id
  where pvs.parent_program_version_id=125 order by pvs.sort_order`)

await show('7. Pagos de ambos', `
  select p.payment_id, p.enrollment_id, p.amount, p.payment_date::date, p.cat_method_payment, p.cat_payment_type,
         p.settled_in_account_id, pi.cat_status estado_cuota
  from payments p left join payment_installments pi on pi.installment_id=p.installment_id
  where p.enrollment_id in (14596,14709) order by p.enrollment_id`)

await show('8. SISTEMICO: destinos CC/RP con customer distinto al origen', `
  select d.enrollment_id destino, d.customer_id cust_destino, o.enrollment_id origen, o.customer_id cust_origen,
         po.document_number doc_origen, trim(concat_ws(' ', po.first_name, po.last_name)) alumno, d.registration_date::date
  from enrollments d
  join enrollments o on o.enrollment_id = (regexp_match(d.notes, 'inscripcion #(\\d+)'))[1]::int
  join customers co on co.customer_id = o.customer_id join persons po on po.person_id = co.person_id
  where d.notes ~ 'inscripcion #[0-9]+' and d.customer_id <> o.customer_id order by d.enrollment_id desc`)

await c.end()
