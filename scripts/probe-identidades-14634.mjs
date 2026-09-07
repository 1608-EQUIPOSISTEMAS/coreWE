// Reconstruye las identidades reales metidas en la ficha 14634 buscando cada
// correo/telefono en el resto de la BD (leads, otras personas). Solo lectura:
// lo que no se pueda probar con un dato existente NO se inventa.
import { q, pool } from './db.mjs'

const CORREOS = ['maricielotabrajmurillo@gmail.com', 'bri.lizeth.4901@gmail.com',
                 'asabogal@lima-airport.com', 'jpablotorres85@gmail.com',
                 'n.avila@slimstock.com', 'johan.augusto2001@gmail.com']
const TELEFONOS = ['977728927', '983448910', '998330453', '993510883', '957157582', '987364691']

console.log('=== esos correos en OTRAS personas (fuera de 14634) ===')
console.table((await q(`
  select pc.value correo, p.person_id, p.document_number dni,
         concat_ws(' ', p.first_name, p.last_name, p.mother_last_name) nombre, p.active
  from person_contacts pc join persons p on p.person_id = pc.person_id
  where lower(trim(pc.value)) = any($1) and p.person_id <> 14634
  order by pc.value`, [CORREOS])).rows)

console.log('\n=== esos telefonos en OTRAS personas ===')
console.table((await q(`
  select pc.value telefono, p.person_id, p.document_number dni,
         concat_ws(' ', p.first_name, p.last_name, p.mother_last_name) nombre
  from person_contacts pc join persons p on p.person_id = pc.person_id
  where trim(pc.value) = any($1) and p.person_id <> 14634
  order by pc.value`, [TELEFONOS])).rows)

console.log('\n=== leads con esos correos o telefonos ===')
console.table((await q(`
  select lead_id, full_name, origin_email, origin_phone, person_id, enrollment_id,
         registration_date::date reg
  from leads
  where lower(trim(origin_email)) = any($1) or trim(origin_phone) = any($2)
  order by lead_id`, [CORREOS, TELEFONOS])).rows)

console.log('\n=== las 6 inscripciones de 14634, con su correo/telefono apareado ===')
console.table((await q(`
  select e.enrollment_id id, e.registration_date at time zone 'America/Lima' registrado,
         u.name registro, e.total_amount monto, pr.program_name programa, e.odoo_email,
         (select pc.value from person_contacts pc where pc.person_id = 14634
           and pc.cat_way_contact = 2318
           and abs(extract(epoch from pc.registration_date - e.registration_date)) < 5 limit 1) correo,
         (select pc.value from person_contacts pc where pc.person_id = 14634
           and pc.cat_way_contact = 2319
           and abs(extract(epoch from pc.registration_date - e.registration_date)) < 5 limit 1) telefono
  from enrollments e
  join customers c on c.customer_id = e.customer_id
  left join users u on u.user_id = e.user_registration_id
  left join program_versions pv on pv.program_version_id = e.program_version_id
  left join programs pr on pr.program_id = pv.program_id
  where c.person_id = 14634 order by e.enrollment_id`)).rows)

await pool.end()
