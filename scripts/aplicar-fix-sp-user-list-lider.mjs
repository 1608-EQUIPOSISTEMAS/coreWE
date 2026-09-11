// Aplica scripts/fix-sp-user-list-lider.sql y verifica que el universo de
// asesores incluya a los LIDER_COMERCIAL sin duplicar al que tiene ambos roles.
//   node scripts/aplicar-fix-sp-user-list-lider.mjs                      (pruebas)
//   DOTENV_CONFIG_PATH=.env.bak-produccion node scripts/aplicar-fix-sp-user-list-lider.mjs
import fs from 'node:fs'
import { q, pool } from './db.mjs'

// El universo se lee por el PROCEDURE porque es lo que llama el backend
// (callProcedureReturningRows) y porque sp_user_list() a secas es ambiguo.
async function universo () {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query("CALL public.sp_user_list('cur_chk')")
    const { rows } = await c.query('FETCH ALL FROM cur_chk')
    await c.query('COMMIT')
    return rows
  } finally { c.release() }
}

console.log('BD:', (await q('SELECT current_database(), inet_server_port()')).rows[0])
await q(fs.readFileSync('scripts/fix-sp-user-list-lider.sql', 'utf8'))
console.log('SPs aplicados.')

const filas = await universo()
const ids = new Set(filas.map(f => f.user_id))
console.table(filas.map(f => ({ user_id: f.user_id, alias: f.alias, active: f.active })))
if (filas.length !== ids.size) throw new Error(`sp_user_list duplica: ${filas.length} filas / ${ids.size} usuarios`)

const { rows: lideres } = await q(`
  SELECT u.user_id, u.alias FROM users u
   JOIN user_roles ur ON ur.user_id = u.user_id
   JOIN rol r         ON r.rol_id   = ur.rol_id
  WHERE r.alias = 'LIDER_COMERCIAL'`)
const faltan = lideres.filter(l => !ids.has(l.user_id))
if (faltan.length) throw new Error(`lideres fuera del universo: ${faltan.map(f => f.alias)}`)

console.log(`OK: ${filas.length} asesores, sin duplicados, con los ${lideres.length} LIDER_COMERCIAL adentro.`)
await pool.end()
