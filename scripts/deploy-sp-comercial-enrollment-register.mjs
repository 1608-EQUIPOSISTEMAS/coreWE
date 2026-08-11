// Despliega scripts/sp_comercial_enrollment_register.sql, probandolo antes contra
// la BD real dentro de una transaccion que SIEMPRE se revierte.
//
// Es el SP que usan TODOS los asesores para inscribir, asi que la prueba cubre
// las dos ramas que conviven tras el cambio de OS/OP:
//   A) venta normal al contado -> cuota 1 pendiente + placeholder en payments
//                                 (el comportamiento de siempre, no puede moverse)
//   B) venta con Orden de Servicio -> cuota 1 pendiente y NINGUN payment: la
//                                     empresa deposita semanas despues
//   C) OS + plan de cuotas -> rechazada, en vez de perder el plan en silencio
//
//   node scripts/deploy-sp-comercial-enrollment-register.mjs --dry   # solo prueba
//   node scripts/deploy-sp-comercial-enrollment-register.mjs         # prueba y aplica
import { readFile } from 'node:fs/promises'
import { pool } from './db.mjs'

const DRY = process.argv.includes('--dry')
const SQL_PATH = new URL('./sp_comercial_enrollment_register.sql', import.meta.url)

const catalogId = async (client, alias) => {
  const { rows } = await client.query('SELECT catalog_id FROM public.catalog WHERE alias = $1 LIMIT 1', [alias])
  if (!rows.length) throw new Error(`catalogo ${alias} inexistente`)
  return rows[0].catalog_id
}

async function callRegister (client, leadId, userId, inscription) {
  const cursor = 'cur_smoke_comercial'
  await client.query('CALL public.sp_comercial_enrollment_register($1,$2,$3,$4)',
    [leadId, userId, JSON.stringify({ inscription }), cursor])
  const { rows } = await client.query(`FETCH ALL FROM ${cursor}`)
  await client.query(`CLOSE ${cursor}`)
  return rows[0] ?? { result: 0, message: 'sin respuesta' }
}

async function scenario (client, ctx, { titulo, extra, esperado }) {
  await client.query('SAVEPOINT esc')
  // El SP exige fecha de pago en el lead antes de matricular; se revierte con
  // el savepoint igual que el resto.
  await client.query('UPDATE public.leads SET pay_date = NOW()::date WHERE lead_id = $1', [ctx.leadId])

  const insc = {
    document: '99999903',
    cat_type_document: ctx.catTypeDoc,
    full_name: 'SMOKE', last_name: 'TEST COMERCIAL', mother_last_name: 'X',
    email: 'smoke.comercial@we-educacion.local',
    cat_insc_modality: ctx.catInscModality,
    cat_certificate_status: ctx.catCertificate,
    cat_payment_channel: ctx.channelGeneral,
    cat_type_payment: ctx.paymentSingle,
    cat_method_payment: ctx.methodTransfer,
    cat_currency: 1,
    list_price: 1000,
    total_amount: 1000,
    observations: 'smoke test (revertido)',
    // El canal General exige adjunto. En una venta OS/OP este archivo es la
    // orden, no un voucher, pero viaja por el mismo campo.
    ticket_payment_urls: [{ url: 'http://smoke.local/comprobante.pdf', name: 'smoke.pdf', type: 'application/pdf' }],
    ...extra
  }

  const res = await callRegister(client, ctx.leadId, ctx.userId, insc)
  console.log(`\n── ${titulo}`)
  console.log(`   respuesta: result=${res.result} ${res.message ?? ''}`)

  let ok = res.result === esperado.result
  if (!ok) console.log(`   ✗ result ${res.result}, esperado ${esperado.result}`)

  // Un rechazo tiene que serlo por el motivo esperado: sin esto un guard previo
  // que corta antes daria la prueba por buena.
  if (ok && esperado.mensaje && !(res.message || '').includes(esperado.mensaje)) {
    ok = false; console.log(`   ✗ el rechazo no menciona "${esperado.mensaje}"`)
  }

  if (ok && res.result === 1) {
    const { rows: [head] } = await client.query(
      'SELECT total_amount, cat_b2b_doctype FROM public.enrollments WHERE enrollment_id = $1', [res.enrollment_id])
    const { rows: cuotas } = await client.query(
      'SELECT installment_number, amount, cat_status FROM public.payment_installments WHERE enrollment_id = $1', [res.enrollment_id])
    const { rows: [pagos] } = await client.query(
      'SELECT COUNT(*)::int AS n FROM public.payments WHERE enrollment_id = $1', [res.enrollment_id])

    console.log(`   cabecera: total=${head.total_amount} doctype=${head.cat_b2b_doctype ?? 'null'}`)
    console.log(`   cuotas: ${cuotas.length} (${cuotas.map(c => `#${c.installment_number}=${c.amount}/${c.cat_status}`).join(' ')}) · payments: ${pagos.n}`)

    if (String(head.cat_b2b_doctype ?? 'null') !== String(esperado.doctype)) {
      ok = false; console.log(`   ✗ doctype ${head.cat_b2b_doctype}, esperado ${esperado.doctype}`)
    }
    if (ok && cuotas.length !== 1) { ok = false; console.log(`   ✗ ${cuotas.length} cuotas, esperada 1`) }
    if (ok && Number(cuotas[0].cat_status) !== ctx.instPending) {
      ok = false; console.log(`   ✗ cuota en estado ${cuotas[0].cat_status}, esperado pendiente (${ctx.instPending})`)
    }
    if (ok && pagos.n !== esperado.payments) {
      ok = false; console.log(`   ✗ ${pagos.n} payments, esperados ${esperado.payments}`)
    }
  }
  console.log(ok ? '   ✓ OK' : '   ✗ FALLA')

  await client.query('ROLLBACK TO SAVEPOINT esc')
  return ok
}

const client = await pool.connect()
let aprobado = false
try {
  await client.query('BEGIN')
  await client.query(await readFile(SQL_PATH, 'utf8'))
  console.log('SP compila.')

  const { rows: [u] } = await client.query('SELECT MIN(user_id) AS user_id FROM public.users')
  // Un lead ya inscrito serviria igual (el SP lo pisa), pero uno libre deja la
  // prueba mas cerca del caso real.
  const { rows: [lead] } = await client.query(`
    SELECT l.lead_id FROM public.leads l
    JOIN public.program_versions pv ON pv.program_version_id = l.program_version_id
    WHERE l.enrollment_id IS NULL AND l.program_version_id IS NOT NULL
    ORDER BY l.lead_id DESC LIMIT 1`)
  if (!lead) throw new Error('no hay lead libre con programa para la prueba')

  const ctx = {
    userId: u.user_id,
    leadId: lead.lead_id,
    catTypeDoc: await catalogId(client, 'we_type_document_dni'),
    catInscModality: await catalogId(client, 'we_insc_modality_normal'),
    catCertificate: await catalogId(client, 'we_certificate_status_paid'),
    channelGeneral: await catalogId(client, 'we_channel_general'),
    paymentSingle: await catalogId(client, 'we_payment_way_single'),
    paymentInstall: await catalogId(client, 'we_payment_way_installments'),
    methodTransfer: await catalogId(client, 'we_payment_method_transfer'),
    instPending: await catalogId(client, 'we_payment_status_pending'),
    osDoctype: await catalogId(client, 'we_enrollment_b2b_doctype_service_order')
  }
  console.log(`user: ${ctx.userId} · lead: ${ctx.leadId}`)

  const a = await scenario(client, ctx, {
    titulo: 'A) venta normal al contado → placeholder de pago intacto',
    extra: {},
    esperado: { result: 1, doctype: 'null', payments: 1 }
  })
  const b = await scenario(client, ctx, {
    titulo: 'B) venta con Orden de Servicio → cuota pendiente sin pago',
    extra: { cat_b2b_doctype: ctx.osDoctype },
    esperado: { result: 1, doctype: ctx.osDoctype, payments: 0 }
  })
  const c = await scenario(client, ctx, {
    titulo: 'C) OS + cuotas → rechazada',
    extra: { cat_b2b_doctype: ctx.osDoctype, cat_type_payment: ctx.paymentInstall, saved_money: 300 },
    esperado: { result: 2, mensaje: 'OS/OP' }
  })
  aprobado = a && b && c
} finally {
  await client.query('ROLLBACK')
  client.release()
}

if (!aprobado) {
  console.log('\nPrueba en rojo: NO se despliega.')
  await pool.end()
  process.exit(1)
}

if (DRY) {
  console.log('\n--dry: prueba en verde, no se aplico nada.')
} else {
  await pool.query(await readFile(SQL_PATH, 'utf8'))
  console.log('\nSP desplegado.')
}
await pool.end()
