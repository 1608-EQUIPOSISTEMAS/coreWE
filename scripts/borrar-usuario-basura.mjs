// Borra fisicamente un usuario de prueba junto con el rastro que lo ancla.
//
//   node scripts/borrar-usuario-basura.mjs 15                    # reporta (local)
//   node scripts/borrar-usuario-basura.mjs 15 --aplicar
//   node scripts/borrar-usuario-basura.mjs 15 --prod [--aplicar] # tunel 55432
//
// public.users tiene 38 FK con NO ACTION apuntandole: user_registration_id y
// user_modification_id son la firma de quien creo cada fila, y Postgres rechaza
// el DELETE mientras exista UNA sola fila hija. Ese candado es correcto para un
// trabajador de verdad -- borrarlo dejaria ventas sin autor -- y por eso el
// camino normal es la baja logica (active = 'N').
//
// El borrado fisico solo es legitimo cuando el rastro TAMBIEN es basura. Como
// eso no se puede deducir del esquema, el script exige que todo lo que encuentre
// caiga dentro de PURGABLES y aborta si aparece cualquier otra tabla: una venta,
// un lead o un pago reales nunca deben desaparecer por borrar a un usuario.
import fs from 'fs'

// La URL de produccion se lee del respaldo, nunca se escribe aqui. Va antes del
// import de db.mjs porque el pool se arma en el import.
if (process.argv.includes('--prod')) {
  process.env.DATABASE_URL = fs.readFileSync('.env.bak-produccion', 'utf8').match(/postgresql:\/\/\S+/)[0]
}
const { q, pool } = await import('./db.mjs')

// En orden de dependencia: los hijos antes que los padres.
// audit_logs no tiene FK (no frena el DELETE) pero quedaria huerfano.
const PURGABLES = [
  ['audit_logs', 'user_id'],
  ['customers', 'user_registration_id'],
  ['persons', 'user_registration_id'],
  ['user_roles', 'user_id']
]

const esPurgable = (tabla, columna) =>
  PURGABLES.some(([t, c]) => t === tabla && c === columna)

// Toda columna que apunte a users, tenga FK o no: las que la tienen frenan el
// DELETE, las que no lo dejan pasar y dejan filas huerfanas.
async function referenciasAUsuarios () {
  const { rows } = await q(`
    SELECT src.relname AS tabla, a.attname AS columna
      FROM pg_constraint c
      JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_class dst ON dst.oid = c.confrelid
      JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f' AND dst.relname = 'users'
    UNION
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public'
       AND c.table_name NOT LIKE '%backup%'
       AND c.table_name <> 'users'
       AND (c.column_name ~ 'user.*id' OR c.column_name IN ('created_by', 'updated_by', 'approved_by', 'assigned_to'))
       AND c.column_name NOT LIKE 'odoo%'
     ORDER BY 1, 2`)
  return rows
}

async function rastrear (userId) {
  const huella = []
  for (const { tabla, columna } of await referenciasAUsuarios()) {
    const { rows } = await q(`SELECT COUNT(*)::int AS n FROM public.${tabla} WHERE ${columna} = $1`, [userId])
    if (rows[0].n) huella.push({ tabla, columna, filas: rows[0].n })
  }
  return huella
}

async function main () {
  const userId = Number(process.argv[2])
  const aplicar = process.argv.includes('--aplicar')
  if (!Number.isInteger(userId)) throw new Error('Falta el user_id: node scripts/borrar-usuario-basura.mjs <id> [--aplicar]')

  const { rows: [usuario] } = await q('SELECT user_id, alias, name, email, active FROM public.users WHERE user_id = $1', [userId])
  if (!usuario) throw new Error(`No existe el usuario ${userId}`)
  console.log('Usuario:', usuario)

  const huella = await rastrear(userId)
  console.table(huella.length ? huella : [{ tabla: '(ninguna)', columna: '', filas: 0 }])

  const intocables = huella.filter(h => !esPurgable(h.tabla, h.columna))
  if (intocables.length) {
    console.error('\nABORTA: hay rastro fuera de PURGABLES. Revisalo a mano antes de borrar:')
    console.error(intocables.map(h => `  ${h.tabla}.${h.columna} (${h.filas})`).join('\n'))
    return
  }

  if (!aplicar) {
    console.log('\nSimulacion. Volve a correrlo con --aplicar para borrar.')
    return
  }

  await q('BEGIN')
  try {
    for (const [tabla, columna] of PURGABLES) {
      const { rowCount } = await q(`DELETE FROM public.${tabla} WHERE ${columna} = $1`, [userId])
      if (rowCount) console.log(`  -${rowCount} ${tabla}`)
    }
    const { rowCount } = await q('DELETE FROM public.users WHERE user_id = $1', [userId])
    console.log(`  -${rowCount} users`)
    await q('COMMIT')
    console.log('\nListo. Rastro restante:', (await rastrear(userId)).length)
  } catch (error) {
    await q('ROLLBACK')
    throw error
  }
}

await main()
await pool.end()
