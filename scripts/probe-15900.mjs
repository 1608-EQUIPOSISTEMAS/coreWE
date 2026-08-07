// Estado real de una inscripcion y su desglose de descuentos: la matview muestra
// el valor de CATALOGO del descuento, no el calculated_amount, asi que el badge
// puede verse bien y la cabecera estar descuadrada.
//   node scripts/probe-15900.mjs 15900
import { q, pool } from './db.mjs'

const ids = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number)
if (!ids.length) throw new Error('uso: node scripts/probe-15900.mjs <enrollment_id...>')

const { rows: heads } = await q(`
  SELECT e.enrollment_id, e.list_price, e.discount_amount, e.total_amount,
         e.list_price - e.total_amount AS descuento_implicito
  FROM public.enrollments e WHERE e.enrollment_id = ANY($1::int[]) ORDER BY 1
`, [ids])
console.table(heads)

const { rows: dsc } = await q(`
  SELECT ed.enrollment_id, ed.discount_id, d.description, d.value AS valor_catalogo,
         ed.order_applied, ed.calculated_amount
  FROM public.enrollment_discounts ed
  JOIN public.discounts d ON d.discount_id = ed.discount_id
  WHERE ed.enrollment_id = ANY($1::int[])
  ORDER BY ed.enrollment_id, ed.order_applied
`, [ids])
console.table(dsc)

for (const h of heads) {
  const suma = dsc.filter(r => r.enrollment_id === h.enrollment_id)
                  .reduce((a, r) => a + Number(r.calculated_amount), 0)
  const cuadra = Math.abs(suma - Number(h.discount_amount)) < 0.01
  console.log(`${h.enrollment_id}: suma desglose ${suma.toFixed(2)} vs discount_amount ${h.discount_amount} → ${cuadra ? 'cuadra' : 'DESCUADRADO'}`)
}

await pool.end()
