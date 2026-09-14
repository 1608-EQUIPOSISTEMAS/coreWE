// Enrollment 16983: FICO registro la venta al contado por S/300, pero lo cobrado
// fue S/195. Error de registro, a solicitud de FICO.
//
// El precio de lista (S/300) no cambia: la diferencia se lleva a discount_amount
// para mantener total = list_price - discount. El monto vive en tres sitios
// (enrollments, la cuota unica y su pago) y se tocan los tres, o el listado FICO
// y el detalle cuadran distinto. La venta no tiene orden Odoo: no hay nada que
// sincronizar alla.
//
// Guarda: solo actua si el estado sigue siendo el registrado (S/300). Reejecutar
// despues de aplicado no hace nada.
//
// Uso (desde Backend/): node scripts/fix-16983-inicial-195.mjs [--aplicar]
// Sin --aplicar hace ensayo y revierte.
import fs from 'node:fs'
import pg from 'pg'

const ENROLLMENT_ID = 16983
const CUOTA_ID = 17525
const PAGO_ID = 9438
const MONTO_REGISTRADO = 300
const MONTO_REAL = 195

const aplicar = process.argv.includes('--aplicar')

const url = fs.readFileSync(new URL('../.env.bak-produccion', import.meta.url), 'utf8')
  .split('\n').map(l => l.trim().replace(/^#\s*/, ''))
  .find(l => l.startsWith('DATABASE_URL=') && l.includes('55432'))
  ?.slice('DATABASE_URL='.length).replace(/^["']|["']$/g, '')
if (!url) throw new Error('No encontre la DATABASE_URL del tunel (55432)')

const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 15000, keepAlive: true })

async function snapshot (client) {
  const [enrollment, cuotas, pagos] = await Promise.all([
    client.query('SELECT * FROM enrollments WHERE enrollment_id=$1', [ENROLLMENT_ID]),
    client.query('SELECT * FROM payment_installments WHERE enrollment_id=$1 ORDER BY installment_number', [ENROLLMENT_ID]),
    client.query('SELECT * FROM payments WHERE enrollment_id=$1 ORDER BY payment_id', [ENROLLMENT_ID])
  ])
  return { enrollment: enrollment.rows[0], cuotas: cuotas.rows, pagos: pagos.rows }
}

const resumen = (s) => ({
  total: s.enrollment.total_amount,
  lista: s.enrollment.list_price,
  descuento: s.enrollment.discount_amount,
  cuotas: s.cuotas.map(c => `#${c.installment_id}: S/${c.amount}`),
  pagos_activos: s.pagos.filter(p => p.active === 'Y').map(p => `#${p.payment_id}: S/${p.amount}`)
})

let guardado = false
const client = await pool.connect()
try {
  console.log('BD:', (await client.query('SELECT current_database() AS db')).rows[0].db)
  await client.query('BEGIN')
  const antes = await snapshot(client)
  console.log('ANTES  ', resumen(antes))
  if (Number(antes.enrollment?.total_amount) !== MONTO_REGISTRADO) {
    throw new Error(`total_amount=${antes.enrollment?.total_amount}, se esperaba ${MONTO_REGISTRADO}: ya corregido o cambio por otro lado`)
  }

  const descuento = Number(antes.enrollment.list_price) - MONTO_REAL
  await client.query(
    'UPDATE enrollments SET total_amount=$1, discount_amount=$2, modification_date=NOW() WHERE enrollment_id=$3',
    [MONTO_REAL, descuento, ENROLLMENT_ID]
  )
  await client.query('UPDATE payment_installments SET amount=$1 WHERE installment_id=$2 AND enrollment_id=$3', [MONTO_REAL, CUOTA_ID, ENROLLMENT_ID])
  await client.query('UPDATE payments SET amount=$1 WHERE payment_id=$2 AND enrollment_id=$3', [MONTO_REAL, PAGO_ID, ENROLLMENT_ID])
  // performed_by NULL: la bitacora lo muestra como "Sistema". Firmar con el id de
  // alguien que no ejecuto el cambio seria mentir en el historial.
  await client.query(`
    INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
    VALUES ($1, 'edited', NULL, $2, $3::jsonb, $4)
  `, [
    ENROLLMENT_ID,
    'Correccion solicitada por FICO: error en el registro de la inicial',
    JSON.stringify({
      'Pago inicial': { old: `S/${MONTO_REGISTRADO}.00`, new: `S/${MONTO_REAL}.00` },
      'Total': { old: antes.enrollment.total_amount, new: MONTO_REAL.toFixed(2) },
      'Descuento': { old: antes.enrollment.discount_amount, new: descuento.toFixed(2) }
    }),
    `A solicitud de FICO: se confundieron en el registro. Inicial corregida de S/${MONTO_REGISTRADO} a S/${MONTO_REAL} ` +
    `(cuota ${CUOTA_ID} y pago ${PAGO_ID}). Total ajustado a S/${MONTO_REAL}, sigue al contado.`
  ])

  const despues = await snapshot(client)
  console.log('DESPUES', resumen(despues))

  // Invariantes de dinero: si alguna falla, la venta quedaria descuadrada en el listado.
  const d = despues.enrollment
  const pagado = despues.pagos.filter(p => p.active === 'Y').reduce((t, p) => t + Number(p.amount), 0)
  if (Number(d.list_price) - Number(d.discount_amount) !== Number(d.total_amount)) throw new Error('lista - descuento != total')
  if (pagado !== MONTO_REAL) throw new Error(`pagado ${pagado} != ${MONTO_REAL}`)
  if (despues.cuotas.length !== 1 || Number(despues.cuotas[0].amount) !== MONTO_REAL) throw new Error('cuota con monto distinto')

  if (!aplicar) {
    await client.query('ROLLBACK')
    console.log('\nENSAYO: nada se guardo. Corre de nuevo con --aplicar.')
  } else {
    fs.writeFileSync(new URL('./_backup_16983_inicial.json', import.meta.url), JSON.stringify(antes, null, 2))
    await client.query('COMMIT')
    guardado = true
    console.log('\nAPLICADO. Respaldo previo en scripts/_backup_16983_inicial.json')
    // CONCURRENTLY: sin eso bloquea las lecturas del panel FICO mientras corre.
    await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_enrollment_report_system')
    console.log('Matview mv_enrollment_report_system refrescada.')
  }
} catch (err) {
  // La conexion pudo morir con el tunel: el ROLLBACK tambien fallaria y taparia el error real.
  await client.query('ROLLBACK').catch(() => {})
  console.error(guardado ? 'Correccion GUARDADA, pero fallo el REFRESH (relanzarlo solo):' : 'FALLO, nada se guardo:', err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
