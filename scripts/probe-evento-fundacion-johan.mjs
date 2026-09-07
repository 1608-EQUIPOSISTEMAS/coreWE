// Sondeo del caso "JOHAN AUGUSTO GASPAR JUAREZ" repetido en el evento de
// Fundacion (02-04/09/2026): saber si el ERP fusiono personas distintas o si
// la hoja de origen ya traia el nombre repetido en filas distintas.
import { q, pool } from './db.mjs'

console.log('=== personas con apellido GASPAR JUAREZ ===')
console.table((await q(`
  select p.person_id, p.document_number dni, p.first_name, p.last_name, p.mother_last_name,
         p.registration_date::date reg, p.user_registration_id user_reg
  from persons p
  where fn_txt_key(concat_ws(' ', p.last_name, p.mother_last_name)) like '%GASPAR%JUAREZ%'
     or fn_txt_key(concat_ws(' ', p.first_name, p.last_name)) like '%GASPAR JUAREZ%'
  order by p.person_id`)).rows)

console.log('\n=== inscripciones a eventos registradas 02-05/09/2026 ===')
console.table((await q(`
  select e.enrollment_id id, e.registration_date::date reg, e.user_registration_id user_reg,
         p.person_id, p.document_number dni,
         concat_ws(' ', p.first_name, p.last_name, p.mother_last_name) alumno,
         pr.program_name programa, e.total_amount monto
  from enrollments e
  join customers c on c.customer_id = e.customer_id
  join persons p on p.person_id = c.person_id
  left join program_versions pv on pv.program_version_id = e.program_version_id
  left join programs pr on pr.program_id = pv.program_id
  where e.registration_date::date between '2026-09-02' and '2026-09-05'
    and e.cat_event_category is not null
  order by e.enrollment_id`)).rows)

console.log('\n=== cuantas personas comparten un DNI "en ceros" ===')
console.table((await q(`
  select document_number, count(*) personas
  from persons
  where document_number ~ '^0+$'
  group by 1 order by 2 desc limit 10`)).rows)

await pool.end()
