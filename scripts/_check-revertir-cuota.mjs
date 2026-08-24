// Self-check de revertir-cuota-a-pendiente.mjs contra la BD LOCAL de pruebas:
// simula la confirmacion equivocada de FICO sobre la cuota, corre el script real
// y verifica que todo volvio a como estaba. Falla ruidoso si no.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { q, pool } from './db.mjs'

const ENROLLMENT = 3290
const CUOTA = 3

if (!process.env.DATABASE_URL?.includes('5433')) {
  throw new Error('Este check solo corre contra la BD local de pruebas (puerto 5433)')
}

const leer = async () => {
  const { rows } = await q(`
    SELECT i.installment_id, i.cat_status,
           (SELECT COUNT(*) FROM payments p WHERE p.installment_id = i.installment_id AND p.active = 'Y') AS pagos_vivos
      FROM payment_installments i WHERE i.enrollment_id = $1 AND i.installment_number = $2`, [ENROLLMENT, CUOTA])
  return rows[0]
}

const original = await leer()

// Simula lo que hace confirmInstallmentTx: cuota pagada + fila de pago.
await q('UPDATE payment_installments SET cat_status = 4454 WHERE installment_id = $1', [original.installment_id])
const { rows: [pago] } = await q(`
  INSERT INTO payments (enrollment_id, installment_id, amount, payment_date, cat_payment_type, cat_settlement_status, active, user_registration_id, registration_date)
  VALUES ($1, $2, 395, '2026-08-24', 3115, 2573, 'Y', 2, NOW()) RETURNING payment_id`, [ENROLLMENT, original.installment_id])

const confirmada = await leer()
assert.equal(Number(confirmada.cat_status), 4454, 'la simulacion no dejo la cuota pagada')
assert.equal(Number(confirmada.pagos_vivos), Number(original.pagos_vivos) + 1)

execFileSync('node', ['scripts/revertir-cuota-a-pendiente.mjs', String(ENROLLMENT), String(CUOTA), '--aplicar'], { stdio: 'inherit' })

const revertida = await leer()
assert.equal(Number(revertida.cat_status), Number(original.cat_status), 'la cuota no volvio a su estado original')
assert.equal(Number(revertida.pagos_vivos), Number(original.pagos_vivos), 'quedo un pago vivo')

const { rows: [audit] } = await q(
  `SELECT justificacion, details FROM enrollment_audit_log WHERE enrollment_id = $1 ORDER BY performed_at DESC LIMIT 1`, [ENROLLMENT])
assert.match(audit.justificacion, /solicitud de FICO/, 'no se escribio la justificacion')
assert.match(audit.details, new RegExp(`Cuota ${CUOTA} devuelta a Pendiente`))

// Limpieza: el pago simulado y su entrada de bitacora no son historia real.
await q('DELETE FROM payments WHERE payment_id = $1', [pago.payment_id])
await q(`DELETE FROM enrollment_audit_log WHERE audit_id = (SELECT MAX(audit_id) FROM enrollment_audit_log WHERE enrollment_id = $1)`, [ENROLLMENT])

console.log('\nOK: la reversion deja la cuota y los pagos como estaban, y escribe la bitacora.')
await pool.end()
