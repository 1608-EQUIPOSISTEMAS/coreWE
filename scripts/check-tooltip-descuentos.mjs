// Check del tooltip de descuentos: la query de paymentDetailDiscounts + el armado
// de la linea que hace EnrollmentFinancials.vue. Corre contra enrollments reales
// de cada tipo (porcentaje / monto fijo / beneficio).
//   node scripts/check-tooltip-descuentos.mjs [enrollment_id ...]
import assert from 'node:assert'
import { q, pool } from './db.mjs'

const SQL = `
  SELECT d.description, d.value, ed.calculated_amount,
         ct.alias AS discount_type_alias, ct.description AS discount_type
    FROM enrollment_discounts ed
    JOIN discounts d ON d.discount_id = ed.discount_id
    LEFT JOIN public."catalog" ct ON ct.catalog_id = d.cat_discount_type
   WHERE ed.enrollment_id = $1
   ORDER BY ed.order_applied`

const money = v => Number(v).toFixed(2)

// Mismo armado que discountLines() en EnrollmentFinancials.vue
const linea = d => {
  const monto = `- S/. ${money(d.calculated_amount)}`
  if (d.discount_type_alias === 'we_discount_type_percentage') return `${d.description} — ${Number(d.value)}%  ${monto}`
  if (d.discount_type_alias === 'we_discount_type_fixed') return `${d.description} — precio fijo S/. ${money(d.value)}  ${monto}`
  return `${d.description}  ${monto}`
}

const ids = process.argv.slice(2).map(Number)
if (!ids.length) {
  // uno de cada tipo, para que el check cubra las tres ramas
  const { rows } = await q(`
    SELECT DISTINCT ON (d.cat_discount_type) ed.enrollment_id
      FROM enrollment_discounts ed JOIN discounts d USING (discount_id)
     ORDER BY d.cat_discount_type, ed.enrollment_id DESC`)
  ids.push(...rows.map(r => r.enrollment_id))
}

for (const id of ids) {
  const { rows } = await q(SQL, [id])
  const { rows: [e] } = await q(
    'SELECT list_price, discount_amount, total_amount FROM enrollments WHERE enrollment_id=$1', [id])
  console.log(`\n#${id}  lista ${e.list_price} - dscto ${e.discount_amount} = ${e.total_amount}`)
  rows.forEach(d => console.log('   ' + linea(d)))

  // El descuento de la barra tiene que ser la suma de lo que lista el tooltip.
  const suma = rows.reduce((s, d) => s + Number(d.calculated_amount), 0)
  assert.strictEqual(money(suma), money(e.discount_amount),
    `#${id}: tooltip suma ${money(suma)} pero discount_amount es ${money(e.discount_amount)}`)
  // Y lista - descuento tiene que dar el total.
  assert.strictEqual(money(Number(e.list_price) - suma), money(e.total_amount),
    `#${id}: lista - descuento != total`)
}

console.log('\nOK: el tooltip cuadra con la barra en', ids.length, 'enrollments')
await pool.end()
