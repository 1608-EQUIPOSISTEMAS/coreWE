// La OS de Molitalia reparte el total entre 5 personas y la ultima (5/5, enrollment
// 2498) absorbe el redondeo: su parte real es S/368.01, no los S/245 que quedaron
// de la importacion. Se alinean las tres filas que hablan de plata para que la
// venta, la cuota y el pago digan lo mismo; si divergen, la hoja FICO muestra un
// saldo fantasma.
//
// El descuento se recalcula contra list_price, no se toca a mano: la hoja compara
// PRECIO - DESCUENTO = TOTAL y una resta que no cierra sale como venta observada.
//
// Idempotente y en una sola transaccion (el tunel SSH se cae seguido).
//
// Uso:  node scripts/ajustar-monto-2498.mjs [--aplicar]
import { writeFileSync } from 'node:fs'
import { q, pool } from './db.mjs'

const ENROLLMENT_ID = 2498
const TOTAL = '368.01'

const foto = () => q(`
  SELECT e.enrollment_id, e.total_amount, e.list_price, e.discount_amount,
         pi.installment_id, pi.amount AS cuota,
         py.payment_id, py.amount AS pago
    FROM enrollments e
    LEFT JOIN payment_installments pi ON pi.enrollment_id = e.enrollment_id
    LEFT JOIN payments py ON py.installment_id = pi.installment_id AND py.active = 'Y'
   WHERE e.enrollment_id = $1`, [ENROLLMENT_ID])

console.log('BD:', (await q('SELECT current_database() AS db')).rows[0].db)
const antes = (await foto()).rows
console.table(antes)

if (!process.argv.includes('--aplicar')) {
  console.log('\n(dry-run) volver a correr con --aplicar')
  await pool.end()
  process.exit(0)
}

writeFileSync(new URL(`./_backup_${ENROLLMENT_ID}_monto.json`, import.meta.url),
  JSON.stringify(antes, null, 2))

await q('BEGIN')
try {
  await q(`UPDATE enrollments
              SET total_amount = $2,
                  discount_amount = list_price - $2::numeric,
                  modification_date = NOW()
            WHERE enrollment_id = $1`, [ENROLLMENT_ID, TOTAL])
  await q(`UPDATE payment_installments SET amount = $2
            WHERE enrollment_id = $1`, [ENROLLMENT_ID, TOTAL])
  await q(`UPDATE payments SET amount = $2
            WHERE enrollment_id = $1 AND active = 'Y'`, [ENROLLMENT_ID, TOTAL])
  await q('COMMIT')
} catch (e) {
  await q('ROLLBACK')
  throw e
}

console.table((await foto()).rows)
// El panel FICO lee la cabecera de la matview, no de enrollments: sin refresh el
// monto viejo sigue en pantalla.
await q('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_enrollment_report_system')
console.log('matview refrescada')
await pool.end()
