// Aplica scripts/sp-lead-company-id.sql en PRODUCCION (tunel SSH 55432).
// Autorizado por el usuario el 2026-08-24. Ya probado en la BD local.
//
// Los 3 CREATE OR REPLACE van en UNA transaccion y en UNA conexion: el tunel se
// cae seguido y a medias quedaria el register parcheado y el get no.
import fs from 'fs'
import pg from 'pg'

const bak = fs.readFileSync(new URL('../.env.bak-produccion', import.meta.url), 'utf8')
const url = bak.match(/^\s*#?\s*DATABASE_URL=(postgresql:\/\/[^\s]+55432[^\s]*)/m)?.[1]
if (!url) throw new Error('no encontre la DATABASE_URL del tunel en .env.bak-produccion')

const sql = fs.readFileSync(new URL('./sp-lead-company-id.sql', import.meta.url), 'utf8')

const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 15000, keepAlive: true })
pool.on('error', (e) => console.error('[tunel] socket idle perdido:', e.message))

// El tunel se cae seguido y tumba la conexion antes de que llegue el SQL. Se
// reintenta la operacion COMPLETA (no un pedazo): al ir toda en una
// transaccion, un intento fallido no deja el esquema a medias.
const aplicarConReintento = async (intentos = 5) => {
  for (let i = 1; i <= intentos; i++) {
    const cliente = await pool.connect().catch(e => e)
    if (cliente instanceof Error) {
      console.log(`intento ${i}/${intentos}: no conecto (${cliente.message})`)
      if (i === intentos) throw cliente
      continue
    }
    try {
      await cliente.query('BEGIN')
      await cliente.query(sql)
      await cliente.query('COMMIT')
      console.log(`Aplicado en PRODUCCION (intento ${i}).`)
      return
    } catch (e) {
      await cliente.query('ROLLBACK').catch(() => {})
      console.log(`intento ${i}/${intentos}: fallo (${e.message})`)
      if (i === intentos) throw e
    } finally {
      cliente.release()
    }
  }
}

await aplicarConReintento()

// Verificacion: los 3 procedures tienen que mencionar company_id.
const { rows } = await pool.query(`
  SELECT p.proname, pg_get_functiondef(p.oid) LIKE '%company_id%' AS tiene_company_id
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('sp_comercial_lead_register','sp_comercial_lead_update','sp_comercial_lead_get')
   ORDER BY p.proname`)
console.table(rows)
await pool.end()
