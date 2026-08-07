// Despliega scripts/sp_fico_enrollment_register_direct.sql, probandolo antes
// contra la BD real dentro de una transaccion que SIEMPRE se revierte.
//
// Que prueba (el SP no guardaba NINGUN descuento: los recibia y los tiraba):
//   A) beca + CUENTA CLAUDE  -> fila del beneficio en 0.00 (vale por su etiqueta)
//                               y discount_amount se queda en list_price, que es
//                               la convencion propia del pago cero.
//   B) venta normal + CUENTA CLAUDE -> fila en 100.00 y la cabecera cuadra.
//   C) sin descuentos        -> ni una fila y la cabecera intacta (el flujo que
//                               ya funcionaba no puede cambiar de comportamiento).
//
//   node scripts/deploy-sp-fico-register-direct.mjs --dry   # solo prueba
//   node scripts/deploy-sp-fico-register-direct.mjs         # prueba y aplica
import { readFile } from 'node:fs/promises'
import { pool } from './db.mjs'

const DRY = process.argv.includes('--dry')
const SQL_PATH = new URL('./sp_fico_enrollment_register_direct.sql', import.meta.url)
const DISCOUNT_CUENTA_CLAUDE = 49

const catalogId = async (client, alias) => {
  const { rows } = await client.query(`SELECT catalog_id FROM public.catalog WHERE alias = $1 LIMIT 1`, [alias])
  if (!rows.length) throw new Error(`catalogo ${alias} inexistente`)
  return rows[0].catalog_id
}

async function callRegister (client, userId, inscription) {
  const cursor = 'cur_smoke_fico'
  await client.query('CALL public.sp_fico_enrollment_register_direct($1,$2,$3)',
    [userId, JSON.stringify({ inscription }), cursor])
  const { rows } = await client.query(`FETCH ALL FROM ${cursor}`)
  await client.query(`CLOSE ${cursor}`)
  return rows[0] ?? { result: 0, message: 'sin respuesta' }
}

async function scenario (client, ctx, { titulo, extra, esperado }) {
  await client.query('SAVEPOINT esc')

  const insc = {
    document_number: '99999902',
    cat_type_document: ctx.catTypeDoc,
    first_name: 'SMOKE', last_name: 'TEST FICO',
    email: 'smoke.fico@we-educacion.local',
    program_version_id: ctx.programVersionId,
    cat_insc_modality: await catalogId(client, 'we_insc_modality_normal'),
    cat_payment_way: await catalogId(client, 'we_payment_way_single'),
    cat_payment_medium: await catalogId(client, 'we_payment_method_transfer'),
    cat_currency: 1,
    observations: 'smoke test (revertido)',
    list_price: 1000,
    total_amount: 1000,
    ...extra
  }

  const res = await callRegister(client, ctx.userId, insc)
  console.log(`\n── ${titulo}`)
  console.log(`   respuesta: result=${res.result} ${res.message ?? ''}`)

  let ok = res.result === 1
  if (ok) {
    const { rows: [head] } = await client.query(
      `SELECT list_price, discount_amount, total_amount FROM public.enrollments WHERE enrollment_id = $1`,
      [res.enrollment_id]
    )
    const { rows: dsc } = await client.query(
      `SELECT ed.discount_id, d.description, ed.order_applied, ed.calculated_amount
         FROM public.enrollment_discounts ed
         JOIN public.discounts d ON d.discount_id = ed.discount_id
        WHERE ed.enrollment_id = $1 ORDER BY ed.order_applied`,
      [res.enrollment_id]
    )
    if (dsc.length) console.table(dsc)
    console.log(`   cabecera: list_price=${head.list_price} discount_amount=${head.discount_amount} total_amount=${head.total_amount}`)

    if (esperado.beneficio === null) {
      ok = dsc.length === 0
      if (!ok) console.log('   ✗ se escribieron descuentos donde no habia ninguno')
    } else {
      const badge = dsc.find(r => r.discount_id === DISCOUNT_CUENTA_CLAUDE)
      if (!badge) { ok = false; console.log('   ✗ sin fila del beneficio: no habria badge') }
      else if (Number(badge.calculated_amount) !== esperado.beneficio) {
        ok = false; console.log(`   ✗ beneficio ${badge.calculated_amount}, esperado ${esperado.beneficio}`)
      }
    }
    if (ok && Number(head.discount_amount) !== esperado.discount) {
      ok = false; console.log(`   ✗ discount_amount ${head.discount_amount}, esperado ${esperado.discount}`)
    }
  }
  console.log(ok ? '   ✓ OK' : '   ✗ FALLA')

  await client.query('ROLLBACK TO SAVEPOINT esc')
  return ok
}

const CLAUDE = [{ value: DISCOUNT_CUENTA_CLAUDE, label: 'CUENTA CLAUDE' }]

const client = await pool.connect()
let aprobado = false
try {
  await client.query('BEGIN')
  await client.query(await readFile(SQL_PATH, 'utf8'))
  console.log('SP compila.')

  const { rows: [u] } = await client.query('SELECT MIN(user_id) AS user_id FROM public.users')
  // Programa Online: no exige edicion, que es una variable menos en la prueba.
  const { rows: [pv] } = await client.query(`
    SELECT pv.program_version_id
    FROM public.program_versions pv
    JOIN public.programs p ON p.program_id = pv.program_id
    JOIN public.catalog c  ON c.catalog_id = p.cat_model_modality
    WHERE c.alias = 'we_modality_online'
    ORDER BY pv.program_version_id DESC LIMIT 1
  `)
  if (!pv) throw new Error('no hay programa Online para la prueba')
  const ctx = {
    userId: u.user_id,
    programVersionId: pv.program_version_id,
    catTypeDoc: await catalogId(client, 'we_type_document_dni')
  }
  console.log(`user: ${ctx.userId} · program_version: ${ctx.programVersionId}`)

  const a = await scenario(client, ctx, {
    titulo: 'A) beca + CUENTA CLAUDE → beneficio solo etiqueta',
    extra: { is_scholarship: true, total_amount: 0, dsct_benefit_ids: CLAUDE },
    esperado: { beneficio: 0, discount: 1000 }
  })
  const b = await scenario(client, ctx, {
    titulo: 'B) venta normal + CUENTA CLAUDE → descuenta S/100',
    extra: { total_amount: 900, dsct_benefit_ids: CLAUDE },
    esperado: { beneficio: 100, discount: 100 }
  })
  const c = await scenario(client, ctx, {
    titulo: 'C) sin descuentos → nada cambia',
    extra: {},
    esperado: { beneficio: null, discount: 0 }
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
