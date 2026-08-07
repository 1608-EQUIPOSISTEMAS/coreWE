// Despliega scripts/sp_comercial_enrollment_register.sql, probandolo antes
// contra la BD real dentro de una transaccion que SIEMPRE se revierte.
//
// Que prueba (los dos lados de la regla del beneficio):
//   A) Beca 100% + beneficio  -> la venta pasa y el beneficio queda en 0.00
//      (vale por su etiqueta CUENTA PERSONAL, no por su monto).
//   B) Sin beca + beneficio   -> el beneficio descuenta sus S/100 como siempre.
// Si B dejara de descontar, la regla se habria comido dinero real de una venta
// normal; por eso las dos van juntas.
//
//   node scripts/deploy-sp-comercial-enrollment-register.mjs --dry   # solo prueba
//   node scripts/deploy-sp-comercial-enrollment-register.mjs         # prueba y aplica
import { readFile } from 'node:fs/promises'
import { pool } from './db.mjs'

const DRY = process.argv.includes('--dry')
const SQL_PATH = new URL('./sp_comercial_enrollment_register.sql', import.meta.url)
const DISCOUNT_CUENTA_CLAUDE = 49

const catalogId = async (client, alias) => {
  const { rows } = await client.query(`SELECT catalog_id FROM public.catalog WHERE alias = $1 LIMIT 1`, [alias])
  if (!rows.length) throw new Error(`catalogo ${alias} inexistente`)
  return rows[0].catalog_id
}

// Lead matriculable: con version de programa, con fecha de pago pasada, sin
// inscripcion previa y sin intentos de contacto pendientes (las cuatro guardas
// que el SP valida antes de tocar dinero).
async function findLeadMatriculable (client) {
  const { rows } = await client.query(`
    SELECT l.lead_id
    FROM public.leads l
    WHERE l.enrollment_id IS NULL
      AND l.program_version_id IS NOT NULL
      AND l.pay_date IS NOT NULL AND l.pay_date <= CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_contact_attempts a
        WHERE a.lead_id = l.lead_id AND a.cat_result = 3169   -- mismo guard que el SP
      )
    ORDER BY l.lead_id DESC
    LIMIT 1
  `)
  if (!rows.length) throw new Error('no hay lead matriculable para la prueba')
  return rows[0].lead_id
}

// Descuento porcentual del 100% (la "beca" del catalogo).
async function findBeca100 (client) {
  const { rows } = await client.query(`
    SELECT d.discount_id, d.description
    FROM public.discounts d
    JOIN public.catalog c ON c.catalog_id = d.cat_discount_type
    WHERE c.alias = 'we_discount_type_percentage' AND d.value = 100
    ORDER BY d.discount_id LIMIT 1
  `)
  if (!rows.length) throw new Error('no existe un descuento porcentual de 100%')
  return rows[0]
}

async function callRegister (client, leadId, userId, inscription) {
  const cursor = 'cur_smoke'
  await client.query('CALL public.sp_comercial_enrollment_register($1,$2,$3,$4)',
    [leadId, userId, JSON.stringify({ inscription }), cursor])
  const { rows } = await client.query(`FETCH ALL FROM ${cursor}`)
  await client.query(`CLOSE ${cursor}`)
  return rows[0] ?? { result: 0, message: 'sin respuesta' }
}

async function inspect (client, enrollmentId) {
  const { rows: [head] } = await client.query(
    `SELECT list_price, discount_amount, total_amount FROM public.enrollments WHERE enrollment_id = $1`,
    [enrollmentId]
  )
  const { rows: dsc } = await client.query(
    `SELECT ed.discount_id, d.description, ed.order_applied, ed.calculated_amount
       FROM public.enrollment_discounts ed
       JOIN public.discounts d ON d.discount_id = ed.discount_id
      WHERE ed.enrollment_id = $1 ORDER BY ed.order_applied`,
    [enrollmentId]
  )
  return { head, dsc }
}

// Cada escenario corre en su propio SAVEPOINT: el SP consume el lead (le setea
// enrollment_id) y el segundo escenario necesita ese lead virgen otra vez.
async function scenario (client, { titulo, leadId, userId, base, becaId, esperado }) {
  await client.query('SAVEPOINT esc')

  const insc = {
    email: 'smoke.test@we-educacion.local',
    document: '99999901',
    full_name: 'SMOKE', last_name: 'TEST', mother_last_name: 'ROLLBACK',
    cat_certificate_status: await catalogId(client, 'we_certificate_status_not_requested'),
    cat_insc_modality: await catalogId(client, 'we_insc_modality_normal'),
    cat_payment_channel: await catalogId(client, 'we_channel_general'),
    cat_type_payment: await catalogId(client, 'we_payment_way_single'),
    cat_method_payment: await catalogId(client, 'we_payment_method_transfer'),
    cat_currency: 1,
    observations: 'smoke test (revertido)',
    list_price: base,
    total_amount: esperado.total,
    dsct_porcent_id: becaId,
    dsct_benefit_ids: [{ value: DISCOUNT_CUENTA_CLAUDE, label: 'CUENTA CLAUDE' }],
    ticket_payment_urls: [{ url: 'http://smoke/x.png', name: 'x.png', type: 'image/png' }]
  }

  const res = await callRegister(client, leadId, userId, insc)
  console.log(`\n── ${titulo}`)
  console.log(`   respuesta: result=${res.result} ${res.message ?? ''}`)

  let ok = res.result === 1
  if (ok) {
    const { head, dsc } = await inspect(client, res.enrollment_id)
    console.table(dsc)
    console.log(`   cabecera: list_price=${head.list_price} discount_amount=${head.discount_amount} total_amount=${head.total_amount}`)

    const badge = dsc.find(r => r.discount_id === DISCOUNT_CUENTA_CLAUDE)
    ok = !!badge && Number(badge.calculated_amount) === esperado.beneficio
                 && Number(head.total_amount) === esperado.total
    if (!badge) console.log('   ✗ no se registro la fila del beneficio: sin ella no hay badge')
    else if (Number(badge.calculated_amount) !== esperado.beneficio) {
      console.log(`   ✗ beneficio ${badge.calculated_amount}, esperado ${esperado.beneficio}`)
    } else if (Number(head.total_amount) !== esperado.total) {
      console.log(`   ✗ total ${head.total_amount}, esperado ${esperado.total}`)
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
  await client.query(await readFile(SQL_PATH, 'utf8'))   // compila el SP nuevo
  console.log('SP compila.')

  const leadId = await findLeadMatriculable(client)
  const beca = await findBeca100(client)
  const { rows: [u] } = await client.query('SELECT MIN(user_id) AS user_id FROM public.users')
  console.log(`lead de prueba: ${leadId} · beca: ${beca.discount_id} "${beca.description}" · user: ${u.user_id}`)

  const a = await scenario(client, {
    titulo: 'A) beca 100% + CUENTA CLAUDE → beneficio solo etiqueta',
    leadId, userId: u.user_id, base: 1000, becaId: beca.discount_id,
    esperado: { beneficio: 0, total: 0 }
  })
  const b = await scenario(client, {
    titulo: 'B) sin beca + CUENTA CLAUDE → el beneficio descuenta S/100',
    leadId, userId: u.user_id, base: 1000, becaId: null,
    esperado: { beneficio: 100, total: 900 }
  })
  aprobado = a && b
} finally {
  await client.query('ROLLBACK')            // nada de la prueba queda en la BD
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
