// Ensayo end-to-end de las correcciones FICO (corregir inicial y revertir cuota)
// contra la BD LOCAL de pruebas. Llama a los usecases reales, asi que prueba
// repository + entity + auditoria juntos.
//
// Se niega a correr si la BD no es system_erp_dev: los usecases escriben con el
// pool del backend, que obedece a Backend/.env.
//
// Uso (desde Backend/): node scripts/ensayo-correcciones-fico.mjs
import { pool } from '../src/shared/db/pool.js'
import { correctInitialPayment, revertInstallmentPayment } from '../src/modules/fico/installment/installment.usecases.js'

const q = (sql, params) => pool.query(sql, params).then(r => r.rows)

const [{ db }] = await q('SELECT current_database() AS db')
if (db !== 'system_erp_dev') throw new Error(`BD ${db}: el ensayo solo corre contra system_erp_dev`)

const [fico] = await q("SELECT ur.user_id FROM user_roles ur JOIN rol r ON r.rol_id = ur.rol_id WHERE r.alias = 'FICO' LIMIT 1")
const userId = fico?.user_id ?? null

async function money (enrollmentId) {
  const [e] = await q('SELECT total_amount, discount_amount, list_price FROM enrollments WHERE enrollment_id = $1', [enrollmentId])
  const cuotas = await q('SELECT installment_number, amount, cat_status FROM payment_installments WHERE enrollment_id = $1 ORDER BY installment_number', [enrollmentId])
  const pagos = await q("SELECT payment_id, installment_id, amount, active FROM payments WHERE enrollment_id = $1 ORDER BY payment_id", [enrollmentId])
  const [audit] = await q('SELECT action, performed_by, justificacion, details FROM enrollment_audit_log WHERE enrollment_id = $1 ORDER BY audit_id DESC LIMIT 1', [enrollmentId])
  return { e, cuotas, pagos, audit }
}

function assert (cond, msg) {
  if (!cond) throw new Error(`FALLO: ${msg}`)
  console.log(`  ok  ${msg}`)
}

// B1: inicial con UN pago activo y monto suficiente para restarle 10.
const [contado] = await q(`
  SELECT e.enrollment_id, e.total_amount, e.list_price, pi.installment_id, pi.amount
    FROM enrollments e
    JOIN payment_installments pi ON pi.enrollment_id = e.enrollment_id AND pi.installment_number = 0
   WHERE pi.amount > 50
     AND (SELECT COUNT(*) FROM payments p WHERE p.installment_id = pi.installment_id AND p.active = 'Y') = 1
   ORDER BY e.enrollment_id DESC LIMIT 1`)
if (!contado) throw new Error('No hay inscripcion con inicial y un pago activo en la BD local')
console.log(`\nB1 corregir inicial · enrollment ${contado.enrollment_id} (inicial S/${contado.amount}, total S/${contado.total_amount})`)
const nuevo = Number(contado.amount) - 10
const totalEsperado = Number(contado.total_amount) - 10
const r1 = await correctInitialPayment({ enrollmentId: contado.enrollment_id, newAmount: nuevo, justificacion: 'ensayo local', userId })
const m1 = await money(contado.enrollment_id)
const pagoInicial = m1.pagos.find(p => p.installment_id === contado.installment_id && p.active === 'Y')
assert(Number(m1.cuotas[0].amount) === nuevo, `cuota 0 = ${nuevo}`)
assert(Number(pagoInicial.amount) === nuevo, `pago activo = ${nuevo}`)
assert(Math.abs(Number(m1.e.total_amount) - totalEsperado) < 0.001, `total = ${totalEsperado}`)
if (m1.e.list_price != null) {
  assert(Math.abs(Number(m1.e.list_price) - Number(m1.e.discount_amount) - Number(m1.e.total_amount)) < 0.001, 'lista - descuento = total')
}
assert(m1.audit.action === 'initial_payment_corrected' && m1.audit.performed_by === userId, `auditoria firmada por user ${userId}`)
console.log('  warnings:', r1.warnings)

// B2: cuota > 0 pagada con pago activo.
const [pagada] = await q(`
  SELECT pi.enrollment_id, pi.installment_id, pi.installment_number
    FROM payment_installments pi
   WHERE pi.installment_number > 0 AND pi.cat_status IN (4454, 2471)
     AND EXISTS (SELECT 1 FROM payments p WHERE p.installment_id = pi.installment_id AND p.active = 'Y')
     AND EXISTS (SELECT 1 FROM payment_installments s WHERE s.enrollment_id = pi.enrollment_id
                  AND s.installment_number > 0 AND s.cat_status NOT IN (4454, 2471, 4456))
   ORDER BY pi.installment_id DESC LIMIT 1`)
console.log(`\nB2 revertir cuota · enrollment ${pagada.enrollment_id} cuota ${pagada.installment_number}`)
const r2 = await revertInstallmentPayment({ enrollmentId: pagada.enrollment_id, installmentId: pagada.installment_id, justificacion: 'ensayo local', userId })
const m2 = await money(pagada.enrollment_id)
const cuota = m2.cuotas.find(c => c.installment_number === pagada.installment_number)
const hermanas = m2.cuotas.filter(c => c.installment_number > 0 && c.installment_number !== pagada.installment_number && ![4454, 2471, 4456].includes(c.cat_status))
assert(![4454, 2471].includes(cuota.cat_status), `cuota quedo en estado ${cuota.cat_status}`)
assert(hermanas.some(h => h.cat_status === cuota.cat_status), 'mismo estado que una hermana pendiente')
assert(!m2.pagos.some(p => p.installment_id === pagada.installment_id && p.active === 'Y'), 'sin pagos activos en la cuota')
assert(m2.audit.action === 'installment_payment_reverted', 'auditoria installment_payment_reverted')
console.log('  warnings:', r2.warnings, '· pagos dados de baja:', r2.deactivated_payments)

// Guardas: revertir de nuevo debe fallar sin escribir.
try {
  await revertInstallmentPayment({ enrollmentId: pagada.enrollment_id, installmentId: pagada.installment_id, justificacion: 'x', userId })
  throw new Error('FALLO: permitio revertir dos veces')
} catch (err) {
  assert(/no esta pagada/.test(err.message), 'segunda reversion rechazada')
}

await pool.end()
console.log('\nENSAYO OK (BD local; los cambios quedan en el clon)')
