// Verifica contra la BD real el flujo OS/OP (venta con Orden de Servicio o de
// Compra: se inscribe hoy, la empresa deposita semanas despues).
//
//   node scripts/probe-os-op-flow.mjs
//
// TODO se hace dentro de UNA transaccion que termina en ROLLBACK: no deja
// enrollment, persona ni pago de prueba en produccion. El SP no hace COMMIT
// interno, asi que el rollback lo alcanza.
//
// Lo que NO cubre: la confirmacion sin pago (confirm_documental) vive en JS y ya
// tiene test en payment-confirmation/__tests__; y el alta desde el formulario del
// asesor (sp_comercial_enrollment_register) necesita un lead real, se prueba a
// mano desde /comercial/leads/new.
import { pool } from './db.mjs'

const fallos = []
const ok = (nombre) => console.log(`  [ok] ${nombre}`)
function assert (condicion, nombre, detalle = '') {
  if (condicion) return ok(nombre)
  fallos.push(nombre)
  console.error(`  [X ] ${nombre}${detalle ? ` -> ${detalle}` : ''}`)
}

// Ejecuta el SP y devuelve su fila de resultado { result, message, enrollment_id }.
async function registrarVenta (client, inscription) {
  const cursor = `cur_probe_${Math.floor(Math.random() * 1e6)}`
  await client.query('CALL public.sp_fico_enrollment_register_direct($1, $2, $3)', [
    9, JSON.stringify({ inscription }), cursor
  ])
  const { rows } = await client.query(`FETCH ALL FROM ${cursor}`)
  await client.query(`CLOSE ${cursor}`)
  return rows[0]
}

const client = await pool.connect()
try {
  await client.query('BEGIN')

  // ── Datos de apoyo ──────────────────────────────────────────────────────
  const { rows: [prog] } = await client.query(`
    SELECT pv.program_version_id, pe.edition_num_id
      FROM public.program_versions pv
      JOIN public.programs p ON p.program_id = pv.program_id
      JOIN public."catalog" cm ON cm.catalog_id = p.cat_model_modality AND cm.alias = 'we_modality_live'
      JOIN public.program_editions pe ON pe.program_version_id = pv.program_version_id AND pe.active = 'Y'
     LIMIT 1`)
  if (!prog) throw new Error('No hay ninguna edicion activa de un programa presencial para la prueba.')

  const { rows: catalogos } = await client.query(`
    SELECT alias, catalog_id FROM public."catalog"
     WHERE alias IN ('we_enrollment_b2b_doctype_service_order', 'we_insc_modality_normal',
                     'we_payment_way_single', 'we_payment_way_installments',
                     'we_payment_status_pending', 'we_payment_type_detraction',
                     'we_payment_type_single', 'we_settlement_status_settled')`)
  const cat = Object.fromEntries(catalogos.map(c => [c.alias, c.catalog_id]))

  console.log('\n1. Catalogo')
  assert(!!cat.we_payment_type_detraction, 'existe we_payment_type_detraction',
    'corre scripts/seed-payment-type-detraction.mjs')
  assert(!!cat.we_enrollment_b2b_doctype_service_order, 'existe el doctype Orden de Servicio')

  const ventaBase = {
    email: 'probe-os-op@we-test.local',
    first_name: 'Probe', last_name: 'OS-OP',
    program_version_id: prog.program_version_id,
    program_edition_id: prog.edition_num_id,
    cat_insc_modality: cat.we_insc_modality_normal,
    client_profile: 'profesional',   // obligatorio en programas con edicion
    cat_b2b_doctype: cat.we_enrollment_b2b_doctype_service_order,
    list_price: 5000, total_amount: 5000,
    cat_payment_way: cat.we_payment_way_single,
    observations: 'PROBE OS/OP - se revierte'
  }

  // ── 1. Alta con OS: monto real y cuota pendiente ────────────────────────
  console.log('\n2. Alta con Orden de Servicio')
  const alta = await registrarVenta(client, ventaBase)
  assert(alta?.result === 1, 'el SP registro la venta', alta?.message)
  if (alta?.result !== 1) throw new Error(`No se pudo registrar: ${alta?.message}`)

  const eid = alta.enrollment_id
  const { rows: [e] } = await client.query(
    'SELECT total_amount, discount_amount, list_price FROM public.enrollments WHERE enrollment_id = $1', [eid])
  assert(Number(e.total_amount) === 5000, 'conserva el monto real (no cae en pago cero)', `total=${e.total_amount}`)
  assert(Number(e.discount_amount) === 0, 'no se inventa un descuento del 100%', `dscto=${e.discount_amount}`)

  const { rows: cuotas } = await client.query(
    'SELECT installment_id, installment_number, amount, cat_status FROM public.payment_installments WHERE enrollment_id = $1', [eid])
  assert(cuotas.length === 1, 'crea una sola cuota', `cuotas=${cuotas.length}`)
  assert(Number(cuotas[0]?.amount) === 5000, 'la cuota es por el total', `monto=${cuotas[0]?.amount}`)
  assert(Number(cuotas[0]?.cat_status) === cat.we_payment_status_pending,
    'la cuota queda PENDIENTE de cobro', `cat_status=${cuotas[0]?.cat_status}`)

  const { rows: [pagos] } = await client.query(
    "SELECT COUNT(*)::int AS n FROM public.payments WHERE enrollment_id = $1 AND active = 'Y'", [eid])
  assert(pagos.n === 0, 'no registra ningun pago: la plata no ha llegado', `pagos=${pagos.n}`)

  // ── 2. Guard: una OS no se vende en cuotas ──────────────────────────────
  console.log('\n3. Guard de cuotas')
  const enCuotas = await registrarVenta(client, {
    ...ventaBase,
    email: 'probe-os-op-cuotas@we-test.local',
    cat_payment_way: cat.we_payment_way_installments,
    saved_money: 1000
  })
  assert(enCuotas?.result === 2, 'rechaza OS + plan de cuotas en vez de perder el plan', enCuotas?.message)

  // ── 3. Cobro tardio: pago + detraccion sobre la MISMA cuota ─────────────
  console.log('\n4. Cobro con detraccion')
  const installmentId = cuotas[0].installment_id
  const insertarPago = (monto, tipo, operacion) => client.query(`
    INSERT INTO public.payments (enrollment_id, installment_id, amount, payment_date, transaction_code,
      cat_payment_type, cat_settlement_status, active, user_registration_id, registration_date)
    VALUES ($1, $2, $3, NOW(), $4, $5, $6, 'Y', 9, NOW())`,
  [eid, installmentId, monto, operacion, tipo, cat.we_settlement_status_settled])

  // we_payment_type_single es el tipo con el que confirmInstallmentTx graba el
  // pago de una cuota (CAT_PAYMENT_TYPE_INSTALLMENT = 3115 en installment.entity.js).
  await insertarPago(4400, cat.we_payment_type_single, 'OP-001')
  await insertarPago(600, cat.we_payment_type_detraction, 'DET-001')

  const { rows: [cobro] } = await client.query(`
    SELECT COUNT(*)::int AS filas, SUM(amount)::numeric AS total,
           COUNT(*) FILTER (WHERE cat_payment_type = $2)::int AS detracciones
      FROM public.payments
     WHERE installment_id = $1 AND active = 'Y'`, [installmentId, cat.we_payment_type_detraction])
  assert(cobro.filas === 2, 'la cuota admite dos pagos (pago + detraccion)', `filas=${cobro.filas}`)
  assert(cobro.detracciones === 1, 'la detraccion queda distinguible por su tipo')
  assert(Number(cobro.total) === 5000, 'los dos depositos suman el monto de la cuota', `suma=${cobro.total}`)

  await client.query('ROLLBACK')
  console.log('\nROLLBACK aplicado: no quedo nada en la BD.')
} catch (err) {
  try { await client.query('ROLLBACK') } catch {}
  console.error('\nFALLO:', err.message)
  fallos.push(err.message)
} finally {
  client.release()
  await pool.end()
}

if (fallos.length) {
  console.error(`\n${fallos.length} verificacion(es) fallaron.`)
  process.exitCode = 1
} else {
  console.log('\nTodo OK.')
}
