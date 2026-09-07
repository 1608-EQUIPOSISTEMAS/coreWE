// Mide cuantas personas son "basureros de identidad": una sola ficha que
// acumula correos y telefonos de gente distinta. Aparecen cuando dos ventas
// distintas traen el MISMO texto en el documento y el SP las da por la misma
// persona.
import { q, pool } from './db.mjs'

console.log('=== top personas por cantidad de correos distintos ===')
console.table((await q(`
  select p.person_id, p.document_number dni,
         concat_ws(' ', p.first_name, p.last_name, p.mother_last_name) nombre,
         count(distinct lower(trim(pc.value))) correos_distintos,
         (select count(*) from customers c join enrollments e on e.customer_id=c.customer_id
           where c.person_id = p.person_id) inscripciones
  from persons p
  join person_contacts pc on pc.person_id = p.person_id and pc.cat_way_contact = 2318 and pc.active='Y'
  group by p.person_id, p.document_number, nombre
  having count(distinct lower(trim(pc.value))) >= 3
  order by 4 desc limit 15`)).rows)

console.log('\n=== documentos "sospechosos" compartidos por varias inscripciones ===')
console.table((await q(`
  select p.document_number dni, p.person_id,
         concat_ws(' ', p.first_name, p.last_name) nombre,
         count(distinct e.enrollment_id) inscripciones,
         count(distinct lower(trim(pc.value))) correos
  from persons p
  join customers c on c.person_id = p.person_id
  join enrollments e on e.customer_id = c.customer_id
  left join person_contacts pc on pc.person_id = p.person_id and pc.cat_way_contact = 2318 and pc.active='Y'
  where p.document_number ~ '^0+$' or p.document_number in ('123456789','11111111','99999999','12345678')
  group by 1,2,3 order by 5 desc nulls last`)).rows)

console.log('\n=== que SP usa cada flujo (produccion) ===')
console.table((await q(`
  select proname,
         (prosrc like '%fn_person_resolve%') as usa_regla_identidad,
         (prosrc like '%document_number = %') as compara_texto_crudo
  from pg_proc
  where proname in ('sp_fico_enrollment_register_direct','sp_comercial_enrollment_register')`)).rows)

await pool.end()
