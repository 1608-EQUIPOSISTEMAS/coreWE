// Enrollment 13986 (BRYAN ZUNIGA CARBONEL, DNI 70524125): FICO registro de mas.
// La inicial cobrada fue S/100, no S/150, y la cuota 1 de S/100 nunca existio.
//
// El usuario pidio DELETE fisico de la cuota 1 (no la baja logica habitual del
// repo): se pierde el voucher y el N.o de operacion 12272705, por eso el script
// deja respaldo JSON del estado previo antes de tocar nada.
//
// El monto de la inicial vive DUPLICADO: en payment_installments.amount (la cuota
// de reserva) y en la fila de payments que la confirmo. Se tocan las dos o el
// listado FICO cuadra distinto que el detalle. El pago #6868 (active='N') es el
// provisional que se dio de baja al confirmar: queda como historial, no se toca.
//
// Uso: node scripts/fix-13986-inicial-y-cuota.mjs [--aplicar]
// Sin --aplicar hace ensayo y revierte.
import fs from 'node:fs'
import pg from 'pg'

const ENROLLMENT_ID = 13986
const CUOTA_INICIAL_ID = 14464
const PAGO_INICIAL_ID = 6880
const CUOTA_BORRADA_ID = 14465
const PAGO_BORRADO_ID = 8510
const NUEVO_TOTAL = 100
const NUEVO_DESCUENTO = 500 // list_price 600 - total 100
const PLAN_AL_CONTADO = 2466 // we_payment_way_single: con una sola cuota ya no es plan en cuotas
const DISCOUNT_ID = 25

const aplicar = process.argv.includes('--aplicar')

const url = fs.readFileSync(new URL('../.env.bak-produccion', import.meta.url), 'utf8')
  .split('\n').map(l => l.trim().replace(/^#\s*/, ''))
  .find(l => l.startsWith('DATABASE_URL=') && l.includes('55432'))
  ?.slice('DATABASE_URL='.length).replace(/^["']|["']$/g, '')
if (!url) throw new Error('No encontre la DATABASE_URL del tunel (55432)')

const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 15000, keepAlive: true })

async function snapshot (client) {
  const [enrollment, cuotas, pagos, descuentos] = await Promise.all([
    client.query('SELECT * FROM enrollments WHERE enrollment_id=$1', [ENROLLMENT_ID]),
    client.query('SELECT * FROM payment_installments WHERE enrollment_id=$1 ORDER BY installment_number', [ENROLLMENT_ID]),
    client.query('SELECT * FROM payments WHERE enrollment_id=$1 ORDER BY payment_id', [ENROLLMENT_ID]),
    client.query('SELECT * FROM enrollment_discounts WHERE enrollment_id=$1', [ENROLLMENT_ID])
  ])
  return { enrollment: enrollment.rows[0], cuotas: cuotas.rows, pagos: pagos.rows, descuentos: descuentos.rows }
}

const resumen = (s) => ({
  total: s.enrollment.total_amount,
  descuento: s.enrollment.discount_amount,
  plan: s.enrollment.cat_payment_plan,
  cuotas: s.cuotas.map(c => `#${c.installment_number}: S/${c.amount}`),
  pagos_activos: s.pagos.filter(p => p.active === 'Y').map(p => `#${p.payment_id}: S/${p.amount}`),
  pagado: s.pagos.filter(p => p.active === 'Y').reduce((t, p) => t + Number(p.amount), 0)
})

const client = await pool.connect()
try {
  await client.query('BEGIN')
  const antes = await snapshot(client)
  if (!antes.enrollment) throw new Error(`No existe el enrollment ${ENROLLMENT_ID}`)

  await client.query('UPDATE payment_installments SET amount=$1 WHERE installment_id=$2', [NUEVO_TOTAL, CUOTA_INICIAL_ID])
  await client.query('UPDATE payments SET amount=$1 WHERE payment_id=$2', [NUEVO_TOTAL, PAGO_INICIAL_ID])
  // El pago va primero: payments.installment_id es la unica FK que apunta a la cuota.
  await client.query('DELETE FROM payments WHERE payment_id=$1', [PAGO_BORRADO_ID])
  await client.query('DELETE FROM payment_installments WHERE installment_id=$1', [CUOTA_BORRADA_ID])
  await client.query(
    'UPDATE enrollments SET total_amount=$1, discount_amount=$2, cat_payment_plan=$3, modification_date=NOW() WHERE enrollment_id=$4',
    [NUEVO_TOTAL, NUEVO_DESCUENTO, PLAN_AL_CONTADO, ENROLLMENT_ID]
  )
  await client.query(
    'UPDATE enrollment_discounts SET calculated_amount=$1 WHERE enrollment_id=$2 AND discount_id=$3',
    [NUEVO_DESCUENTO, ENROLLMENT_ID, DISCOUNT_ID]
  )
  // performed_by NULL: la bitacora lo muestra como "Sistema". Firmar con el id de
  // alguien que no ejecuto el cambio seria mentir en el historial.
  await client.query(`
    INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
    VALUES ($1, 'edited', NULL, $2, $3::jsonb, $4)
  `, [
    ENROLLMENT_ID,
    'Correccion de montos solicitada por FICO',
    JSON.stringify({
      'Pago inicial': { old: 'S/150.00', new: 'S/100.00' },
      'Total': { old: antes.enrollment.total_amount, new: String(NUEVO_TOTAL) },
      'Descuento': { old: antes.enrollment.discount_amount, new: String(NUEVO_DESCUENTO) },
      'Cuota 1': { old: 'S/100.00 Pagada', new: 'Eliminada' }
    }),
    `Inicial corregida de S/150 a S/100 (cuota ${CUOTA_INICIAL_ID} y pago ${PAGO_INICIAL_ID}). ` +
    `Cuota 1 de S/100 eliminada de la BD junto con su pago ${PAGO_BORRADO_ID} (op. 12272705). ` +
    'Total de la venta ajustado a S/100 y plan cambiado a Al contado.'
  ])

  const despues = await snapshot(client)
  console.log('ANTES  ', resumen(antes))
  console.log('DESPUES', resumen(despues))

  // Invariantes de dinero: si alguna falla, la venta quedaria descuadrada en el listado.
  const d = despues.enrollment
  const pagado = despues.pagos.filter(p => p.active === 'Y').reduce((t, p) => t + Number(p.amount), 0)
  if (Number(d.list_price) - Number(d.discount_amount) !== Number(d.total_amount)) throw new Error('lista - descuento != total')
  if (pagado !== NUEVO_TOTAL) throw new Error(`pagado ${pagado} != total ${NUEVO_TOTAL}`)
  if (despues.cuotas.length !== 1 || Number(despues.cuotas[0].amount) !== NUEVO_TOTAL) throw new Error('quedo mas de una cuota o con monto distinto')

  if (!aplicar) {
    await client.query('ROLLBACK')
    console.log('\nENSAYO: nada se guardo. Corre de nuevo con --aplicar.')
  } else {
    fs.writeFileSync(new URL('./_backup_13986_montos.json', import.meta.url), JSON.stringify(antes, null, 2))
    await client.query('COMMIT')
    console.log('\nAPLICADO. Respaldo previo en scripts/_backup_13986_montos.json')
    await client.query('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')
    console.log('Matview mv_enrollment_report_system refrescada.')
  }
} catch (err) {
  await client.query('ROLLBACK')
  console.error('FALLO, nada se guardo:', err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
