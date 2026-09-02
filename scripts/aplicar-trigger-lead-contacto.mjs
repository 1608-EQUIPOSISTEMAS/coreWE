// Aplica scripts/fix-trigger-lead-contacto.sql y verifica el resultado dejando
// la BD como estaba (las pruebas van dentro de transacciones con ROLLBACK).
// El tunel SSH se cae seguido: cada paso reintenta con conexion nueva.
//   DOTENV_CONFIG_PATH=.env.bak-produccion node scripts/aplicar-trigger-lead-contacto.mjs
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

const conectar = async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 })
  c.on('error', (e) => console.error('[socket]', e.message))
  await c.connect()
  return c
}

// Cada paso corre en su propia conexion: si el tunel muere, se reintenta entero.
const conReintento = async (etiqueta, fn, intentos = 4) => {
  for (let i = 1; i <= intentos; i++) {
    let c
    try {
      c = await conectar()
      const r = await fn(c)
      await c.end()
      return r
    } catch (e) {
      try { await c?.end() } catch {} // el socket ya estaba muerto: nada que cerrar
      console.error(`[${etiqueta}] intento ${i}/${intentos}: ${e.message}`)
      if (i === intentos) throw e
    }
  }
}

const DDL = fs.readFileSync('scripts/fix-trigger-lead-contacto.sql', 'utf8')

console.log('BD:', await conReintento('bd', async (c) =>
  (await c.query('SELECT current_database()')).rows[0].current_database))

await conReintento('ddl', async (c) => c.query(DDL))
console.log('DDL aplicado.')

await conReintento('verificacion', async (c) => {
  const { rows: [lead] } = await c.query(
    "SELECT lead_id FROM leads WHERE enrollment_id IS NOT NULL AND user_modification_id = user_registration_id LIMIT 1")

  const intenta = async (sql, params) => {
    await c.query('BEGIN')
    try {
      await c.query(sql, params)
      await c.query('ROLLBACK')
      return 'OK'
    } catch (e) {
      await c.query('ROLLBACK')
      return `BLOQUEADO: ${e.message.split('\n')[0]}`
    }
  }

  console.log('lead de prueba:', lead.lead_id)
  console.log('correo   ->', await intenta('UPDATE leads SET origin_email = $2 WHERE lead_id = $1', [lead.lead_id, 'prueba@ponytail.test']))
  console.log('telefono ->', await intenta('UPDATE leads SET origin_phone = $2 WHERE lead_id = $1', [lead.lead_id, '999999999']))
  console.log('monto    ->', await intenta('UPDATE leads SET agreed_amount = $2 WHERE lead_id = $1', [lead.lead_id, 1]))
})
