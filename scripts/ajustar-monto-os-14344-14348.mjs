// OS del flujo viejo (notes 'OS, PAGA EN 30 DIAS'): 5 alumnos a S/652 c/u. Al
// liberarlas del sync, FICO pidio corregir dos partes del reparto; las otras
// tres (14345, 14346, 14347) se quedan en S/652.
//
// Misma receta que ajustar-monto-2498.mjs: la venta, la cuota y el pago activo
// dicen lo mismo, y el descuento se recalcula contra list_price para que
// PRECIO - DESCUENTO = TOTAL siga cerrando en la hoja.
//
// Aborta si la forma no es 1 cuota + 1 pago activo: con mas filas, pisar todas
// con el mismo monto multiplicaria la plata.
// Idempotente y en una sola transaccion (el tunel SSH se cae seguido).
//
// Uso:  node scripts/ajustar-monto-os-14344-14348.mjs [--aplicar]
import { writeFileSync } from 'node:fs'
import { q, pool } from './db.mjs'

const NUEVO_TOTAL = { 14344: '392.00', 14348: '912.01' }
const IDS = Object.keys(NUEVO_TOTAL).map(Number)

const foto = () => q(`
  SELECT e.enrollment_id, e.list_price, e.discount_amount, e.total_amount,
         (SELECT COUNT(*) FROM payment_installments pi WHERE pi.enrollment_id = e.enrollment_id) AS n_cuotas,
         (SELECT string_agg(pi.amount::text, ',') FROM payment_installments pi WHERE pi.enrollment_id = e.enrollment_id) AS cuota,
         (SELECT COUNT(*) FROM payments py WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y') AS n_pagos,
         (SELECT string_agg(py.amount::text, ',') FROM payments py WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y') AS pago
    FROM enrollments e
   WHERE e.enrollment_id = ANY($1::int[])
   ORDER BY 1`, [IDS])

console.log('BD:', (await q('SELECT current_database() AS db')).rows[0].db)
const antes = (await foto()).rows
console.table(antes)

const deformes = antes.filter(r => Number(r.n_cuotas) !== 1 || Number(r.n_pagos) !== 1)
if (antes.length !== IDS.length || deformes.length) {
  console.error('Forma inesperada, no se toca nada:', deformes)
  await pool.end()
  process.exit(1)
}

if (!process.argv.includes('--aplicar')) {
  console.log('\n(dry-run) volver a correr con --aplicar')
  await pool.end()
  process.exit(0)
}

writeFileSync(new URL('./_backup_os_14344_14348_monto.json', import.meta.url),
  JSON.stringify(antes, null, 2))

await q('BEGIN')
try {
  for (const [id, total] of Object.entries(NUEVO_TOTAL)) {
    await q(`UPDATE enrollments
                SET total_amount = $2,
                    discount_amount = list_price - $2::numeric,
                    modification_date = NOW()
              WHERE enrollment_id = $1`, [id, total])
    await q('UPDATE payment_installments SET amount = $2 WHERE enrollment_id = $1', [id, total])
    await q(`UPDATE payments SET amount = $2 WHERE enrollment_id = $1 AND active = 'Y'`, [id, total])
  }
  await q('COMMIT')
} catch (e) {
  await q('ROLLBACK')
  throw e
}

console.table((await foto()).rows)
// El panel FICO lee la matview, no enrollments: sin refresh sigue el monto viejo.
await q('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_enrollment_report_system')
console.log('matview refrescada')
await pool.end()
