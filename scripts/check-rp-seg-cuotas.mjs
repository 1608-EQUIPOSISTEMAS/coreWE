// Chequeo del filtro de cuotas pendientes del RP (rpPendingCuotas en
// EnrollmentActions.vue) contra el payload real de sp_fico_payment_detail_get.
//
//   node scripts/check-rp-seg-cuotas.mjs [enrollment_id]      (default 12002)
//
// Un SEG (hijo de paquete) trae una unica cuota de S/0 ya pagada. Si esa cuota
// entra al "nuevo plan de cuotas", el plan pide montos > 0 que sumen 0 y el
// boton Siguiente queda deshabilitado para siempre.
import assert from 'node:assert/strict'
import { pool } from './db.mjs'

const ID = Number(process.argv[2] || 12002)
const PAID_ALIASES = ['we_inst_paid', 'we_payment_status_paid']

// Copia literal del filtro del front (EnrollmentActions.vue).
const pendientes = (detail) => {
  const conPago = new Set((detail.payment_history || []).map(p => p.installment_id))
  return (detail.installments || []).filter(i =>
    i.installment_number > 0 &&
    Number(i.amount) > 0 &&
    !PAID_ALIASES.includes(i.status_alias) &&
    ![4454, 2471, 4456].includes(Number(i.cat_status)) &&
    !conPago.has(i.installment_id)
  )
}

const c = await pool.connect()
try {
  await c.query('BEGIN')
  await c.query(`CALL public.sp_fico_payment_detail_get($1,'cur')`, [ID])
  const { rows: [detail] } = await c.query('FETCH ALL FROM cur')
  await c.query('ROLLBACK')

  assert.ok(detail, `sp_fico_payment_detail_get no devolvio nada para ${ID}`)
  assert.equal(Number(detail.total_amount), 0, `el ${ID} no es una inscripcion de pago cero`)

  const pend = pendientes(detail)
  assert.equal(pend.length, 0,
    `un SEG no tiene cuotas que trasladar, pero el filtro dejo pasar ${pend.length}: ${JSON.stringify(pend)}`)

  // canAdvanceRP: sin cuotas pendientes basta edicion + justificacion.
  const canAdvanceRP = (edicion, justif) => edicion !== null && justif.trim().length > 0 && (pend.length === 0)
  assert.equal(canAdvanceRP(15096, 'reprogramacion'), true, 'con edicion y justificacion el boton debe habilitarse')
  assert.equal(canAdvanceRP(null, 'reprogramacion'), false, 'sin edicion destino no debe habilitarse')

  console.log(`OK — SEG #${ID}: 0 cuotas por trasladar y "Siguiente" se habilita con edicion + justificacion.`)
} catch (err) {
  await c.query('ROLLBACK').catch(() => {})
  console.error('FALLO:', err.message)
  process.exitCode = 1
} finally { c.release(); await pool.end() }
