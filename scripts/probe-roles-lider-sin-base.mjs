// Sondeo: usuarios cuyo unico rol de area es LIDER_* (sin el rol base). Esos
// caen fuera de sp_user_list / sp_user_list_by_role y no aparecen como asesor
// elegible. Ver caso AE30 (user 2, solo LIDER_COMERCIAL).
import { q, pool } from './db.mjs'

const { rows } = await q(`
  SELECT u.user_id, u.alias, u.active, p.first_name, p.last_name,
         array_agg(r.alias ORDER BY r.alias) AS roles,
         (SELECT count(*) FROM enrollments e WHERE e.seller_agent_id = u.user_id) AS ventas,
         (SELECT count(*) FROM leads l WHERE l.user_registration_id = u.user_id) AS leads
    FROM users u
    JOIN persons p     ON p.person_id = u.person_id
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN rol r         ON r.rol_id   = ur.rol_id
   GROUP BY u.user_id, u.alias, u.active, p.first_name, p.last_name
   ORDER BY u.user_id`)

const BASE = { LIDER_COMERCIAL: 'COMERCIAL', LIDER_B2B: 'B2B', LIDER_FUNDACION: 'FUNDACION' }
console.log('== lider sin rol base ==')
for (const r of rows) {
  for (const [lider, base] of Object.entries(BASE)) {
    if (r.roles.includes(lider) && !r.roles.includes(base)) {
      console.log(`user ${r.user_id} ${r.alias} active=${r.active} roles=[${r.roles}] ventas=${r.ventas} leads=${r.leads}`)
    }
  }
}
console.log('\n== usuarios con ventas que sp_user_list NO devuelve (sin rol COMERCIAL) ==')
for (const r of rows) {
  if (Number(r.ventas) > 0 && !r.roles.includes('COMERCIAL')) {
    console.log(`user ${r.user_id} ${r.alias} roles=[${r.roles}] ventas=${r.ventas}`)
  }
}
console.log('\n== user 2 / 38 ==')
for (const r of rows) if ([2, 38].includes(r.user_id)) console.log(r.user_id, r.alias, r.roles, 'ventas=' + r.ventas)
await pool.end()
