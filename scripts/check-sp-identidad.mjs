// Prueba de humo del SP parchado, TODO dentro de una transaccion que se
// revierte: reproduce el escenario del incendio (venta sin DNI del mismo
// alumno) y afirma que ya NO nace una persona gemela.
//
//   node scripts/check-sp-identidad.mjs
import assert from 'node:assert/strict'
import { pool } from './db.mjs'

const USER_ID = 9
const EMAIL = 'angelsgabrielr97@gmail.com'

const call = async (c, insc) => {
  await c.query('BEGIN')
  const { rows } = await c.query(
    'CALL public.sp_fico_enrollment_register_direct($1, $2, $3)',
    [USER_ID, JSON.stringify({ inscription: insc }), 'cur'])
  const { rows: out } = await c.query('FETCH ALL FROM cur')
  return out[0]
}

const base = {
  first_name: 'ANGEL SERGIO', last_name: 'GABRIEL RECAVARREN', email: EMAIL,
  phone: '999999999', program_version_id: 166, // MEMBRESIA BLACK
  client_profile: 'profesional', list_price: 1900, total_amount: 1900,
  // mismos catalogos que la venta real 14703 (membresia BLACK, contado, WEB)
  cat_insc_modality: 2626, cat_payment_way: 2466, cat_currency: 3041,
  cat_payment_channel: 4301, saved_money: 1900,
  agent_origin: 'WEB', observations: 'PRUEBA (revertida)'
}

const c = await pool.connect()
try {
  const antes = (await c.query(
    "SELECT COUNT(*)::int n FROM public.persons WHERE active='Y'")).rows[0].n

  // Venta SIN documento: antes creaba persona nueva; ahora debe reusar la que existe.
  const r = await call(c, base)
  console.log('SP responde:', r)
  const { rows: [p] } = await c.query(`
    SELECT cu.person_id, per.document_number
      FROM public.enrollments e
      JOIN public.customers cu ON cu.customer_id = e.customer_id
      JOIN public.persons per ON per.person_id = cu.person_id
     WHERE e.enrollment_id = $1`, [r.enrollment_id])
  const despues = (await c.query(
    "SELECT COUNT(*)::int n FROM public.persons WHERE active='Y'")).rows[0].n

  console.log('persona resuelta:', p, '| personas creadas:', despues - antes)
  assert.equal(r.result, 1, `el SP fallo: ${r.message}`)
  assert.equal(despues - antes, 0, 'nacio una persona gemela')
  assert.equal(p.document_number, '72569421', 'no reuso la persona con DNI')
  console.log('\nOK: venta sin DNI -> reusa la persona existente, cero gemelas')
} finally {
  await c.query('ROLLBACK').catch(() => {})
  c.release()
  await pool.end()
}
