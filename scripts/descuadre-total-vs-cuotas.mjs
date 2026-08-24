// Solo lectura: inscripciones cuya cabecera (enrollments.total_amount) no
// coincide con la suma de sus cuotas. Son las que muestran un saldo y un total
// distintos entre la ficha y el listado.
//
//   node scripts/descuadre-total-vs-cuotas.mjs           # produccion (tunel)
//   node scripts/descuadre-total-vs-cuotas.mjs --local   # BD de pruebas
import fs from 'fs'
import pg from 'pg'

const local = process.argv.includes('--local')
let url = 'postgresql://postgres:postgres@127.0.0.1:5433/system_erp_dev'
if (!local) {
  const bak = fs.readFileSync(new URL('../.env.bak-produccion', import.meta.url), 'utf8')
  url = bak.match(/^\s*#?\s*DATABASE_URL=(postgresql:\/\/[^\s]+55432[^\s]*)/m)?.[1]
}
const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 15000, keepAlive: true })

// El tunel SSH se cae seguido y tumba la conexion antes de que llegue la
// query. Es de solo lectura, asi que reintentar es inofensivo.
const consultar = async (sql, intentos = 5) => {
  for (let i = 1; i <= intentos; i++) {
    try {
      return await pool.query(sql)
    } catch (e) {
      console.log(`intento ${i}/${intentos}: ${e.message}`)
      if (i === intentos) throw e
    }
  }
}

const { rows } = await consultar(`
  SELECT e.enrollment_id,
         e.list_price, e.discount_amount, e.total_amount,
         c.cuotas, c.suma,
         (e.total_amount - c.suma) AS diferencia,
         e.registration_date::date AS registro
    FROM public.enrollments e
    JOIN LATERAL (
      SELECT COUNT(*)::int AS cuotas, COALESCE(SUM(amount), 0)::numeric AS suma
        FROM public.payment_installments WHERE enrollment_id = e.enrollment_id
    ) c ON TRUE
   WHERE e.active = 'Y'
     AND c.cuotas > 0
     AND e.total_amount IS DISTINCT FROM c.suma
   ORDER BY abs(e.total_amount - c.suma) DESC`)

console.log(local ? '(BD LOCAL)' : '(PRODUCCION)', 'inscripciones descuadradas:', rows.length)
console.table(rows.slice(0, 25))
if (rows.length > 25) console.log(`... y ${rows.length - 25} mas`)

const suma = rows.reduce((a, r) => a + Math.abs(Number(r.diferencia)), 0)
console.log('diferencia absoluta acumulada: S/.', suma.toFixed(2))
await pool.end()
