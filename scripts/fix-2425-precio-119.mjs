// One-off (2026-09-03): JIMENEZ YEREMY JAVIER, enrollment 2425 (SAP HANA MM E121).
//
// FICO tipeo el precio mal: la venta es lista 264.00 con el descuento GLOBAL 55%
// (discounts.id=13), o sea 264 x 0.45 = 118.80, y quedo grabada en 118.00 en vez
// de 119.00. El monto vive en cuatro filas a la vez y hay que moverlas juntas:
// tocar solo total_amount dejaria la inscripcion con S/1.00 de saldo fantasma.
//
//   enrollments.total_amount        118.00 -> 119.00
//   enrollments.discount_amount     145.20 -> 145.00  (para que 264 - dscto = 119)
//   enrollment_discounts.calculated_amount  igual
//   payment_installments #1 (3137)  118.00 -> 119.00
//   payments 2177 (el activo)       118.00 -> 119.00
//
// El payment 2153 NO se toca: esta active='N', es el registro anulado del alta y
// su valor historico es justamente haber sido 118.
//
// No sirve editInstallmentAmount() del modulo: solo acepta cuotas pendientes y
// esta ya esta pagada y confirmada. Se deja fila en enrollment_audit_log para que
// el cambio salga en el historial del panel FICO.
//
//   node scripts/fix-2425-precio-119.mjs            # DRY-RUN (PRODUCCION)
//   node scripts/fix-2425-precio-119.mjs --aplicar  # aplica
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const respaldo = fs.readFileSync(path.join(raiz, '.env.bak-produccion'), 'utf8')
process.env.DATABASE_URL = respaldo.match(/^DATABASE_URL=(.+)$/m)[1].trim()
const { pool, query: q } = await import('../src/shared/db/pool.js')

const ID = 2425
const INSTALLMENT = 3137
const PAYMENT = 2177
const USER_ID = 9 // ADMIN
const VIEJO = '118.00'
const NUEVO = '119.00'
const DSCTO_NUEVO = '145.00'
const JUSTIFICACION = 'Equivocacion de FICO al registrar: la venta es 264.00 con GLOBAL 55% = 118.80, se tipeo 118.00'
const aplicar = process.argv.includes('--aplicar')

const foto = async () => ({
  enrollment: (await q('SELECT enrollment_id, list_price, discount_amount, total_amount FROM enrollments WHERE enrollment_id=$1', [ID])).rows,
  cuota: (await q('SELECT installment_id, installment_number, amount FROM payment_installments WHERE enrollment_id=$1 ORDER BY 1', [ID])).rows,
  pagos: (await q('SELECT payment_id, amount, active FROM payments WHERE enrollment_id=$1 ORDER BY 1', [ID])).rows,
  descuentos: (await q('SELECT discount_id, calculated_amount FROM enrollment_discounts WHERE enrollment_id=$1', [ID])).rows
})

const antes = await foto()
console.log('--- antes ---'); console.dir(antes, { depth: null })

if (antes.enrollment[0]?.total_amount === NUEVO) {
  console.log('\nYa esta en 119.00: nada que hacer (idempotente).')
  await pool.end(); process.exit(0)
}
if (antes.enrollment[0]?.total_amount !== VIEJO) {
  console.error(`\nEl total no es ${VIEJO} sino ${antes.enrollment[0]?.total_amount}. Revisar a mano.`)
  await pool.end(); process.exit(1)
}

if (!aplicar) {
  console.log(`\nDRY-RUN. total/cuota/pago ${VIEJO} -> ${NUEVO}, descuento 145.20 -> ${DSCTO_NUEVO}. Correr con --aplicar.`)
  await pool.end(); process.exit(0)
}

fs.writeFileSync(new URL(`./_backup_${ID}_2026-09-03.json`, import.meta.url), JSON.stringify(antes, null, 2))

const cx = await pool.connect()
try {
  await cx.query('BEGIN')
  await cx.query('UPDATE enrollments SET total_amount=$2, discount_amount=$3 WHERE enrollment_id=$1', [ID, NUEVO, DSCTO_NUEVO])
  await cx.query('UPDATE enrollment_discounts SET calculated_amount=$2 WHERE enrollment_id=$1', [ID, DSCTO_NUEVO])
  await cx.query('UPDATE payment_installments SET amount=$2 WHERE installment_id=$1', [INSTALLMENT, NUEVO])
  await cx.query('UPDATE payments SET amount=$2 WHERE payment_id=$1', [PAYMENT, NUEVO])
  await cx.query(
    `INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
     VALUES ($1, 'installment_amount_edited', $2, $3, $4::jsonb, $5)`,
    [ID, USER_ID, JUSTIFICACION,
      JSON.stringify({
        'Monto total': { old: 'S/. 118.00', new: 'S/. 119.00' },
        'Descuento': { old: 'S/. 145.20', new: 'S/. 145.00' },
        'Monto cuota #1': { old: 'S/. 118.00', new: 'S/. 119.00' }
      }),
      'Monto cuota #1: S/. 118.00 → S/. 119.00 (correccion de precio por equivocacion de FICO)'])
  await cx.query('COMMIT')
} catch (e) {
  await cx.query('ROLLBACK')
  throw e
} finally {
  cx.release()
}

console.log('--- despues ---'); console.dir(await foto(), { depth: null })

// El panel FICO lee la cabecera de la matview, no de enrollments: sin esto el
// cambio no se ve en pantalla.
await q('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')
console.log('matview refrescada')

await pool.end()
process.exit(0)
