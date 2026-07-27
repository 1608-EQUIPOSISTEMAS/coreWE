// One-off: el asesor cobro 200 pero FICO inscribio desde el token de 100.
// Borra el token 519 (S/100) y el enrollment 14541 que creo, y deja libre el
// token 522 (S/200) + el lead 426394 para que FICO lo inscriba de nuevo.
//
// Seguro de correr: 14541 no tiene payments, no fue a Odoo (odoo_* null) ni al
// Sheet (flag_send='N'); sus cuotas estan en Borrador.
// Idempotente: si ya se corrio, no encuentra nada y no hace nada.
import { writeFileSync } from 'node:fs'
import { q, pool } from './db.mjs'

const ENR = 14541
const TOKEN_MALO = 519 // S/100
const TOKEN_BUENO = 522 // S/200
const LEAD = 426394

const cli = await pool.connect() // ponytail: una sola conexion, el tunel se cae seguido
try {
  // --- respaldo completo antes de tocar nada ---
  const dump = {}
  for (const [k, sql, p] of [
    ['enrollment', 'SELECT * FROM enrollments WHERE enrollment_id = $1', [ENR]],
    ['installments', 'SELECT * FROM payment_installments WHERE enrollment_id = $1', [ENR]],
    ['discounts', 'SELECT * FROM enrollment_discounts WHERE enrollment_id = $1', [ENR]],
    ['payments', 'SELECT * FROM payments WHERE enrollment_id = $1', [ENR]],
    ['tokens', 'SELECT * FROM payment_tokens WHERE token_id = ANY($1::int[])', [[TOKEN_MALO, TOKEN_BUENO]]],
    ['audit', 'SELECT * FROM enrollment_audit_log WHERE enrollment_id = $1 OR token_id = ANY($2::int[])', [ENR, [TOKEN_MALO, TOKEN_BUENO]]],
    ['lead', 'SELECT * FROM leads WHERE lead_id = $1', [LEAD]]
  ]) dump[k] = (await cli.query(sql, p)).rows
  writeFileSync(new URL('./_backup_14541_token519.json', import.meta.url), JSON.stringify(dump, null, 2))
  console.log('respaldo -> _backup_14541_token519.json')

  if (dump.payments.length) throw new Error(`14541 tiene ${dump.payments.length} pago(s): abortado`)

  await cli.query('BEGIN')

  // 1. liberar el lead y el token bueno (deben quedar sin enrollment para que FICO reinscriba)
  const lead = await cli.query(
    'UPDATE leads SET enrollment_id = NULL, pay_date = NULL, modification_date = now() WHERE lead_id = $1 AND enrollment_id = $2',
    [LEAD, ENR])
  const tokBueno = await cli.query(
    'UPDATE payment_tokens SET enrollment_id = NULL, updated_at = now() WHERE token_id = $1',
    [TOKEN_BUENO])

  // 2. borrar lo que cuelga del enrollment malo
  const cuotas = await cli.query('DELETE FROM payment_installments WHERE enrollment_id = $1', [ENR])
  const desc = await cli.query('DELETE FROM enrollment_discounts WHERE enrollment_id = $1', [ENR])
  const audit = await cli.query('DELETE FROM enrollment_audit_log WHERE enrollment_id = $1 OR token_id = $2', [ENR, TOKEN_MALO])
  const tokMalo = await cli.query('DELETE FROM payment_tokens WHERE token_id = $1', [TOKEN_MALO])
  const enr = await cli.query('DELETE FROM enrollments WHERE enrollment_id = $1', [ENR])

  await cli.query('COMMIT')
  console.table([
    { paso: 'lead liberado', filas: lead.rowCount },
    { paso: 'token 522 desligado', filas: tokBueno.rowCount },
    { paso: 'cuotas borradas', filas: cuotas.rowCount },
    { paso: 'descuentos borrados', filas: desc.rowCount },
    { paso: 'audit borrado', filas: audit.rowCount },
    { paso: 'token 519 borrado', filas: tokMalo.rowCount },
    { paso: 'enrollment 14541 borrado', filas: enr.rowCount }
  ])

  // --- verificacion ---
  const { rows: ver } = await cli.query(`
    SELECT t.token_id, t.amount, t.status, t.enrollment_id, t.lead_id,
           l.enrollment_id AS lead_enrollment, l.pay_date::date, l.cat_status_lead,
           (SELECT count(*)::int FROM enrollments WHERE enrollment_id = $1) AS enr_vivo
      FROM payment_tokens t LEFT JOIN leads l ON l.lead_id = t.lead_id
     WHERE t.lead_id = $2 ORDER BY t.token_id`, [ENR, LEAD])
  console.log('--- estado final ---'); console.table(ver)
} catch (e) {
  await cli.query('ROLLBACK').catch(() => {})
  throw e
} finally {
  cli.release()
}
await pool.end()
