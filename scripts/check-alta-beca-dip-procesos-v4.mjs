// Verificacion del alta que hace alta-beca-dip-procesos-v4-edith.mjs. Falla si el
// flujo quedo a medias: sin E0, sin los 4 hijos SEG, con plata donde no debe, con
// la fecha de hoy en vez de la venta de enero, o sin la convalidacion del modulo 1.
//
// Refresca la matview antes de mirar la cabecera FICO: el panel de FICO lee de
// mv_enrollment_report_system, no de enrollments (ver memoria matview-enrollment-report).
//
//   node scripts/check-alta-beca-dip-procesos-v4.mjs
import assert from 'node:assert/strict'
import { q, pool } from './db.mjs'

const PERSONA        = 16061    // EDITH SAWYERS CABRACA
const DIPLOMADO_PV   = 209      // PC-DZ-05 = "DIP PROC Y MEJORA V4"
const CONVALIDADO_PV = 55       // GESTION DE PROCESOS
const LSS_E56        = 15088
const FECHA_VENTA    = '2026-01-30'

const { rows: [padre] } = await q(
  `SELECT e.enrollment_id, e.program_edition_id, e.total_amount, e.discount_amount,
          e.registration_date::date::text AS venta, e.user_registration_id, e.seller_agent_id
     FROM enrollments e JOIN customers c ON c.customer_id = e.customer_id
    WHERE c.person_id = $1 AND e.program_version_id = $2
      AND e.parent_enrollment_id IS NULL AND e.active = 'Y'`,
  [PERSONA, DIPLOMADO_PV])

assert.ok(padre, 'no existe la venta del diplomado')
assert.equal(padre.program_edition_id, null, 'el padre deberia estar en E0 (edicion NULL)')
assert.equal(Number(padre.total_amount), 0, 'la beca no puede tener monto a pagar')
assert.ok(Number(padre.discount_amount) > 0, 'la beca tiene que quedar como descuento, no en cero')
assert.equal(padre.venta, FECHA_VENTA, 'la venta no quedo fechada en enero')
assert.equal(padre.user_registration_id, 21, 'la registro RAFI (user 21)')

const { rows: hijos } = await q(
  `SELECT e.program_version_id, e.program_edition_id, e.total_amount,
          e.registration_date::date::text AS venta, cs.alias AS estado
     FROM enrollments e JOIN catalog cs ON cs.catalog_id = e.cat_type_status
    WHERE e.parent_enrollment_id = $1 ORDER BY e.enrollment_id`, [padre.enrollment_id])

assert.equal(hijos.length, 4, 'faltan hijos SEG (5 modulos - 1 convalidado)')
for (const h of hijos) {
  assert.equal(h.estado, 'we_enrollment_status_tracking', 'todo hijo va SEG')
  assert.equal(Number(h.total_amount), 0, 'el hijo no cobra: la venta vive en el padre')
  assert.equal(h.venta, FECHA_VENTA, 'el hijo tiene que compartir la fecha de la venta')
}
assert.ok(hijos.some(h => h.program_edition_id === LSS_E56), 'falta LEAN SIX SIGMA YELLOW E56')
assert.ok(!hijos.some(h => h.program_version_id === CONVALIDADO_PV),
  'el modulo convalidado no debe tener hijo')

const { rows: [conv] } = await q(
  `SELECT child_version_id, validation_type FROM enrollment_validations WHERE enrollment_id = $1`,
  [padre.enrollment_id])
assert.equal(conv?.child_version_id, CONVALIDADO_PV, 'falta la convalidacion del modulo 1')
assert.equal(conv?.validation_type, 'same_edition', 'la convalidacion es de la misma edicion (E51)')

const { rows: cuotas } = await q(
  'SELECT amount FROM payment_installments WHERE enrollment_id = $1', [padre.enrollment_id])
assert.equal(cuotas.length, 1, 'la beca lleva una sola cuota')
assert.equal(Number(cuotas[0].amount), 0, 'la cuota de la beca va en cero')

const { rows: pagos } = await q(
  'SELECT 1 FROM payments WHERE enrollment_id = $1', [padre.enrollment_id])
assert.equal(pagos.length, 0, 'una beca no genera pagos')

await q('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')
const { rows: [fico] } = await q(
  `SELECT "FECHA DE REGISTRO", "NOMBRE DEL PROGRAMA", "ASESOR", "DSTC. PRINCIPAL",
          "PRECIO LISTA", "TOTAL A PAGAR", "TOTAL DESCONTADO"
     FROM mv_enrollment_report_system WHERE "ID" = $1`, [padre.enrollment_id])
assert.ok(fico, 'la venta no aparece en la cabecera que lee el panel FICO')
assert.match(fico['FECHA DE REGISTRO'], /^30\/01\/2026/, 'la hoja FICO tiene que verla en enero')

console.log(`OK: venta ${padre.enrollment_id} (beca, E0) + ${hijos.length} hijos SEG, fechada ${FECHA_VENTA}`)
console.table([fico])
await pool.end()
