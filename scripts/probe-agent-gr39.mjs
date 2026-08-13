// GR39 (GRECIA, user_id 11) no salia en el dropdown "Editar Asesor": users.active
// estaba en 'N' y sp_user_list castea esa columna a boolean, asi que el front la
// descartaba. Es la comercial con mas ventas del ultimo mes (263), o sea el flag
// estaba mal puesto, no era una baja. Se reactiva solo GR39 (GA38 tiene el mismo
// sintoma pero se deja como esta por decision del usuario).
import { q, pool } from './db.mjs'

const { rows } = await q(
  `UPDATE users SET active = 'Y'
   WHERE alias = 'GR39' AND active <> 'Y'
   RETURNING user_id, alias, name, active`
)
console.log(rows.length ? 'Reactivado:' : 'Sin cambios (ya estaba activo):')
console.table(rows)

const check = await q(`
  SELECT user_id, alias, email, active
  FROM sp_user_list()
  WHERE alias = 'GR39'
`)
console.log('Visible en sp_user_list():')
console.table(check.rows)

await pool.end()
