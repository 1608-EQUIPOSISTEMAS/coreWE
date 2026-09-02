// Prueba del arreglo del trigger leads.block_update_when_enrolled contra la BD
// LOCAL de pruebas: el correo/telefono se pueden corregir tras la venta, el
// resto del lead sigue congelado. Idempotente: hace rollback de todo.
import 'dotenv/config'
import pg from 'pg'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
const [{ current_database: db }] = (await client.query('SELECT current_database()')).rows
if (db !== 'system_erp_dev') throw new Error(`Esta prueba solo corre en local, no en ${db}`)

const { rows: [lead] } = await client.query(
  "SELECT lead_id, origin_email FROM leads WHERE enrollment_id IS NOT NULL AND user_modification_id = user_registration_id LIMIT 1")
console.log('lead de prueba:', lead)

const intenta = async (sql, params) => {
  await client.query('BEGIN')
  try {
    await client.query(sql, params)
    await client.query('ROLLBACK')
    return 'OK'
  } catch (e) {
    await client.query('ROLLBACK')
    return `BLOQUEADO: ${e.message.split('\n')[0]}`
  }
}

console.log('correo   ->', await intenta('UPDATE leads SET origin_email = $2 WHERE lead_id = $1', [lead.lead_id, 'prueba@ponytail.test']))
console.log('telefono ->', await intenta('UPDATE leads SET origin_phone = $2 WHERE lead_id = $1', [lead.lead_id, '999999999']))
console.log('monto    ->', await intenta('UPDATE leads SET agreed_amount = $2 WHERE lead_id = $1', [lead.lead_id, 1]))
await client.end()
