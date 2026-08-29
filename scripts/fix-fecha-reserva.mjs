// Alinea el VENCIMIENTO de la cuota 0 (reserva/inicial) a la fecha real de cobro.
// El SP de alta la sella con la fecha de importacion, no con la F. PAGO de la hoja.
//
//   node scripts/fix-fecha-reserva.mjs <enrollment_id> <YYYY-MM-DD> [--apply]
import { writeFileSync } from 'node:fs'
import { pool } from './db.mjs'

const USER_ID = 9 // ADMIN: la correccion no la hizo el asesor
const EID = Number(process.argv[2])
const FECHA = process.argv[3]
const APLICAR = process.argv.includes('--apply')
if (!EID || !/^\d{4}-\d{2}-\d{2}$/.test(FECHA || '')) {
  console.error('Uso: node scripts/fix-fecha-reserva.mjs <enrollment_id> <YYYY-MM-DD> [--apply]')
  process.exit(1)
}

// El tunel SSH se cae seguido: una sola conexion, reintentada entera.
const conReintento = async (tarea) => {
  for (let intento = 1; ; intento++) {
    const client = await pool.connect().catch((err) => err)
    if (client instanceof Error) {
      if (intento >= 40) throw client
      await new Promise((r) => setTimeout(r, 5000))
      continue
    }
    try {
      return await tarea(client)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      if (!/ECONNREFUSED|ETIMEDOUT|ECONNRESET|terminating connection/i.test(err.message) || intento >= 40) throw err
      console.error(`[tunel] ${err.message} - reintento ${intento}`)
      await new Promise((r) => setTimeout(r, 5000))
    } finally {
      client.release()
    }
  }
}

const resultado = await conReintento(async (client) => {
  const reserva = (await client.query(
    `SELECT installment_id, installment_number, amount, due_date, cat_status
       FROM payment_installments
      WHERE enrollment_id = $1 AND installment_number = 0`, [EID]
  )).rows[0]
  if (!reserva) throw new Error(`El enrollment ${EID} no tiene cuota 0 (reserva)`)

  console.log('ANTES:', reserva)
  const yaEsta = String(reserva.due_date).slice(0, 10) === FECHA ||
    new Date(reserva.due_date).toISOString().slice(0, 10) === FECHA
  if (yaEsta) return { sinCambio: true }
  if (!APLICAR) return { dry: true }

  writeFileSync(new URL(`./_backup_reserva_${EID}.json`, import.meta.url), JSON.stringify(reserva, null, 2))

  await client.query('BEGIN')
  const despues = (await client.query(
    `UPDATE payment_installments SET due_date = $2::date
      WHERE installment_id = $1 RETURNING installment_id, due_date`, [reserva.installment_id, FECHA]
  )).rows[0]
  await client.query(
    `INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes)
     VALUES ($1, 'installment_due_date_corrected', $2, $3, $4::jsonb)`,
    [EID, USER_ID,
      'El SP de alta sella la cuota 0 (reserva) con la fecha de importacion. Se alinea su ' +
      'vencimiento a la F. PAGO real de la hoja FICO. No cambia ningun monto.',
      JSON.stringify({ installment_id: reserva.installment_id, due_date: { old: reserva.due_date, new: FECHA } })]
  )
  await client.query('COMMIT')
  return { despues }
})

if (resultado.sinCambio) console.log('\nLa reserva ya vence en esa fecha: nada que hacer.')
else if (resultado.dry) console.log('\n(dry-run: no se escribio nada; agrega --apply)')
else console.log('DESPUES:', resultado.despues, '\nOJO: falta REFRESH MATERIALIZED VIEW mv_enrollment_report_system.')

await pool.end()
process.exit(0)
