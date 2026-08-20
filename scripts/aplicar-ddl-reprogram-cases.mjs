// Aplica scripts/ddl-reprogram-cases.sql (idempotente) y verifica que la bandeja
// de Reprogramaciones responda. El tunel SSH se cae seguido: un reintento y todo
// el DDL en UNA sola conexion.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pool } from './db.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ddl = readFileSync(join(here, 'ddl-reprogram-cases.sql'), 'utf8')

async function aplicar () {
  const cx = await pool.connect()
  try {
    await cx.query(ddl)
    const { rows: [t] } = await cx.query(`
      SELECT to_regclass('public.reprogram_cases') IS NOT NULL AS existe,
             (SELECT COUNT(*)::int FROM public.reprogram_cases) AS filas`)
    const { rows: [db] } = await cx.query('SELECT current_database() AS db, inet_server_port() AS puerto')
    return { ...db, ...t }
  } finally {
    cx.release()
  }
}

let res
try {
  res = await aplicar()
} catch (err) {
  console.warn('1er intento fallo (tunel?):', err.message, '- reintentando')
  res = await aplicar()
}
console.log(res)
await pool.end()
