// Contraseñas de Odoo / Teams del docente, junto a los usuarios que ya guarda
// la ficha (ver add-instructor-access-and-folders.mjs).
//
// Se guardan EN CLARO a proposito: coordinacion tiene que poder leerlas y
// dictarselas al docente, no verificarlas contra un login. No se puede hashear
// algo que hay que recuperar. Upgrade si algun dia hace falta: cifrado en reposo
// con pgcrypto (pgp_sym_encrypt) + la llave fuera de la BD, y lectura limitada
// por rol en el endpoint.
//
// Idempotente: si el SP ya menciona odoo_password, no se toca.
import { q, pool } from './db.mjs'

const ESQUEMA = `
  ALTER TABLE public.instructors
    ADD COLUMN IF NOT EXISTS odoo_password  text,
    ADD COLUMN IF NOT EXISTS teams_password text;

  COMMENT ON COLUMN public.instructors.odoo_password IS
    'Contraseña de Odoo del docente. En claro: la ficha la muestra para poder dictarla.';
  COMMENT ON COLUMN public.instructors.teams_password IS
    'Contraseña de Teams del docente. En claro: la ficha la muestra para poder dictarla.';
`

// Mismo criterio que los usuarios: CASE + NULLIF para poder BORRAR el dato
// mandando '', cosa que el COALESCE de las columnas vecinas no permite.
const columna = (nombre) =>
  `    ${nombre} = CASE WHEN p_instructor ? '${nombre}' THEN NULLIF(p_instructor->>'${nombre}', '') ELSE i.${nombre} END`

const PARCHES = {
  sp_instructor_update: [
    {
      // El ancla se lleva la coma final de la linea, asi que la reposicion tiene
      // que cerrar con coma: despues viene modification_date.
      ancla: /^\s*teams_username = CASE.*$/m,
      nuevo: `${columna('teams_username')},\n${columna('odoo_password')},\n${columna('teams_password')},`
    }
  ],
  sp_instructor_get: [
    {
      ancla: /^\s*i\.teams_username,$/m,
      nuevo: '      i.teams_username,\n      i.odoo_password,\n      i.teams_password,'
    }
  ]
}

async function definicion (nombre) {
  const { rows } = await q(
    `SELECT pg_get_functiondef(p.oid) AS src
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`,
    [nombre]
  )
  if (rows.length !== 1) throw new Error(`${nombre}: se esperaba 1 definicion, hay ${rows.length}`)
  return rows[0].src
}

function aplicarParches (nombre, src, parches) {
  return parches.reduce((acc, { ancla, nuevo }) => {
    const veces = (acc.match(new RegExp(ancla.source, ancla.flags.replace('m', '') + 'gm')) || []).length
    if (veces !== 1) throw new Error(`${nombre}: el ancla casa ${veces} veces, se esperaba 1: ${ancla}`)
    return acc.replace(ancla, nuevo)
  }, src)
}

await q(ESQUEMA)
console.log('columnas odoo_password / teams_password listas')

for (const [nombre, parches] of Object.entries(PARCHES)) {
  const src = await definicion(nombre)
  if (src.includes('odoo_password')) {
    console.log(`${nombre}: ya parcheado, se omite`)
    continue
  }
  await q(aplicarParches(nombre, src, parches))
  console.log(`${nombre}: parcheado`)
}

const { rows } = await q(`
  SELECT p.proname,
         (pg_get_functiondef(p.oid) LIKE '%odoo_password%')  AS odoo,
         (pg_get_functiondef(p.oid) LIKE '%teams_password%') AS teams
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = ANY($1)
`, [Object.keys(PARCHES)])
console.table(rows)

await pool.end()
