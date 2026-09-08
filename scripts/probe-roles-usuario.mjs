// Roles efectivos de un usuario: es lo que decide en que panel de equipo sale
// (dashboard TEAM_SCOPE_SQL hace EXISTS sobre user_roles, no un rol primario).
//   node scripts/probe-roles-usuario.mjs RAUL
import { q, pool } from './db.mjs'

const patron = process.argv[2] || ''

const { rows } = await q(`
  SELECT u.user_id, u.alias, u.name, u.active,
         string_agg(r.alias, ', ' ORDER BY r.alias) AS roles
    FROM public.users u
    LEFT JOIN public.user_roles ur ON ur.user_id = u.user_id
    LEFT JOIN public.rol r ON r.rol_id = ur.rol_id
   WHERE u.alias ILIKE $1 OR u.name ILIKE $1
   GROUP BY u.user_id, u.alias, u.name, u.active
   ORDER BY u.user_id`, [`%${patron}%`])

console.table(rows)
await pool.end()
