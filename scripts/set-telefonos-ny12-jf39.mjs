// One-off: Nataly Ypanaque (NY12) y Jorge Flores (JF39) tenian users.telefonos
// en NULL, y sin al menos un numero el select "Celular de origen" del formulario
// de consultas queda vacio y no se puede registrar el lead.
import { q, pool } from './db.mjs'

const TELEFONOS = { NY12: '979493060', JF39: '986468310' }

for (const [alias, phone] of Object.entries(TELEFONOS)) {
  const { rows } = await q(
    `UPDATE public.users
        SET telefonos = ARRAY[$2]::text[]
      WHERE alias = $1
        AND COALESCE(cardinality(telefonos), 0) = 0
      RETURNING user_id, alias, name, telefonos`,
    [alias, phone]
  )
  console.log(rows.length ? rows[0] : `${alias}: sin cambios (ya tenia telefonos)`)
}

const { rows } = await q(
  `SELECT user_id, alias, name, telefonos FROM public.users WHERE alias = ANY($1) ORDER BY user_id`,
  [Object.keys(TELEFONOS)]
)
console.table(rows)
await pool.end()
