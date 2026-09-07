// Reconstruye, registro por registro, QUE datos llegaron en las inscripciones al
// V Congreso: el nombre que se escribio contra el correo y telefono que vinieron
// en la misma fila. Los contactos se insertan en el mismo instante que el
// enrollment, asi que el timestamp los aparea sin ambiguedad.
import { q, pool } from './db.mjs'

console.log('=== inscripciones al V Congreso: nombre vs correo recibido ===')
console.table((await q(`
  select e.enrollment_id id,
         e.registration_date at time zone 'America/Lima' as registrado,
         u.name registro_quien,
         p.person_id, p.document_number dni,
         concat_ws(' ', p.first_name, p.last_name, p.mother_last_name) nombre_en_ficha,
         (select pc.value from person_contacts pc
           where pc.person_id = p.person_id and pc.cat_way_contact = 2318
             and abs(extract(epoch from pc.registration_date - e.registration_date)) < 5
           limit 1) correo_de_esta_fila,
         (select pc.value from person_contacts pc
           where pc.person_id = p.person_id and pc.cat_way_contact = 2319
             and abs(extract(epoch from pc.registration_date - e.registration_date)) < 5
           limit 1) telefono_de_esta_fila
  from enrollments e
  join customers c on c.customer_id = e.customer_id
  join persons p on p.person_id = c.person_id
  left join users u on u.user_id = e.user_registration_id
  left join program_versions pv on pv.program_version_id = e.program_version_id
  left join programs pr on pr.program_id = pv.program_id
  where pr.program_name like '%CONGRESO%'
  order by e.registration_date`)).rows)

console.log('\n=== quien registro cada inscripcion al Congreso ===')
console.table((await q(`
  select u.name, u.user_id, count(*) inscripciones,
         count(*) filter (where p.document_number ~ '^0+$') con_dni_en_ceros
  from enrollments e
  join customers c on c.customer_id = e.customer_id
  join persons p on p.person_id = c.person_id
  left join users u on u.user_id = e.user_registration_id
  left join program_versions pv on pv.program_version_id = e.program_version_id
  left join programs pr on pr.program_id = pv.program_id
  where pr.program_name like '%CONGRESO%'
  group by 1,2 order by 3 desc`)).rows)

await pool.end()
