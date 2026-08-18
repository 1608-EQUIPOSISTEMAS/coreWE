// Corrige el monto de una inscripcion cargada con el importe equivocado.
//
// No basta con enrollments.total_amount: las columnas de dinero de la hoja
// Ventas salen de 4 sitios distintos y dejarlos desalineados hace mentir al Sheet.
//   - enrollments.total_amount    -> SALDO
//   - enrollments.discount_amount -> DSCT (= discount / list_price). Se recalcula
//                                    para mantener total = list_price - discount:
//                                    el precio de lista NO cambia, cambia lo que
//                                    se le perdona al alumno.
//   - payment_installments.amount -> INICIAL de las ventas al contado (pi_pt)
//   - payments.amount             -> el registro de la orden de servicio / pago
//
// La matview mv_enrollment_report_system se refresca al final: sin eso el panel
// de FICO sigue mostrando el monto viejo. Va FUERA de la transaccion y tarda,
// asi que si se corta el proceso el dinero ya quedo bien y basta con relanzar el
// REFRESH solo. El sync a Sheets no usa la matview.
//
// NO toca el marcador de importacion: que la venta suba o no al Sheet es una
// decision aparte, en `habilitar-sync-fico.mjs`.
//
// Idempotente: si el monto ya es el nuevo, los UPDATE no cambian nada.
//
// Uso:  node scripts/ajustar-monto-fico.mjs <enrollment_id> <monto> [--aplicar]
//       node scripts/ajustar-monto-fico.mjs 2498 368 --aplicar
import { q, pool } from './db.mjs'

const aplicar = process.argv.includes('--aplicar')
const [ID, MONTO_NUEVO] = process.argv.slice(2).filter(a => /^\d+(\.\d+)?$/.test(a)).map(Number)
if (!ID || !(MONTO_NUEVO >= 0)) {
  console.error('Uso: node scripts/ajustar-monto-fico.mjs <enrollment_id> <monto> [--aplicar]')
  process.exit(1)
}

const foto = async () => (await q(`
  SELECT e.total_amount, e.list_price, e.discount_amount,
         cp.alias AS plan,
         (SELECT json_agg(json_build_object('n', pi.installment_number, 'monto', pi.amount, 'estado', cs.alias) ORDER BY pi.installment_number)
            FROM payment_installments pi JOIN catalog cs ON cs.catalog_id = pi.cat_status
           WHERE pi.enrollment_id = e.enrollment_id) AS cuotas,
         (SELECT json_agg(json_build_object('id', p.payment_id, 'monto', p.amount) ORDER BY p.payment_id)
            FROM payments p WHERE p.enrollment_id = e.enrollment_id AND p.active = 'Y') AS pagos
    FROM enrollments e
    LEFT JOIN catalog cp ON cp.catalog_id = e.cat_payment_plan
   WHERE e.enrollment_id = $1`, [ID])).rows[0]

console.log('BD:', (await q('SELECT current_database() AS db')).rows[0].db)
const antes = await foto()
if (!antes) throw new Error(`el enrollment ${ID} no existe`)
console.log('antes  ->', JSON.stringify(antes, null, 2))

// Guardas: la receta reparte el monto en UNA cuota sin cobrar. Un plan en cuotas
// necesita decidir como se reparte la diferencia entre ellas, y una cuota ya
// pagada dejaria ingreso > total (la hoja diria "Saldado" cobrando de menos).
// En ambos casos es mejor abortar que adivinar.
const PAGADAS = ['we_inst_paid', 'we_payment_status_paid']
if (antes.plan !== 'we_payment_way_single') throw new Error(`plan ${antes.plan}: repartir entre cuotas va a mano`)
if ((antes.cuotas || []).some(c => PAGADAS.includes(c.estado))) throw new Error('hay cuotas pagadas: revisar a mano')

if (!aplicar) {
  console.log(`\n(dry-run) pondria total_amount=${MONTO_NUEVO}, discount_amount=${antes.list_price - MONTO_NUEVO}`)
  console.log('volver a correr con --aplicar')
} else {
  await q('BEGIN')
  try {
    await q(`UPDATE enrollments
                SET total_amount = $2,
                    discount_amount = COALESCE(list_price, 0) - $2,
                    modification_date = NOW()
              WHERE enrollment_id = $1`, [ID, MONTO_NUEVO])
    await q('UPDATE payment_installments SET amount = $2 WHERE enrollment_id = $1', [ID, MONTO_NUEVO])
    await q(`UPDATE payments SET amount = $2 WHERE enrollment_id = $1 AND active = 'Y'`, [ID, MONTO_NUEVO])
    await q('COMMIT')
  } catch (err) {
    await q('ROLLBACK')
    throw err
  }
  await q('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')
  console.log('despues ->', JSON.stringify(await foto(), null, 2))
}
await pool.end()
