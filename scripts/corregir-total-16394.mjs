// Realinea la cabecera de la inscripcion 16394 con sus cuotas en PRODUCCION.
// Editaron la cuota 1 (330 -> 248) y total_amount se quedo con el 410 que
// trajo FICO: la ficha mostraba saldo 330 en vez de 248 y el listado un total
// de 410. Precio real confirmado por el negocio: 328 (80 + 248).
//
// Autorizado por el usuario el 2026-08-24. El precio de lista NO se toca: la
// diferencia la absorbe el descuento (820 = 328 + 492).
import fs from 'fs'
import pg from 'pg'

const ID = 16394

const bak = fs.readFileSync(new URL('../.env.bak-produccion', import.meta.url), 'utf8')
const url = bak.match(/^\s*#?\s*DATABASE_URL=(postgresql:\/\/[^\s]+55432[^\s]*)/m)?.[1]
const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 15000, keepAlive: true })

const conReintento = async (fn, intentos = 5) => {
  for (let i = 1; i <= intentos; i++) {
    try { return await fn() } catch (e) {
      console.log(`intento ${i}/${intentos}: ${e.message}`)
      if (i === intentos) throw e
    }
  }
}

const estado = () => pool.query(`
  SELECT e.list_price, e.discount_amount, e.total_amount,
         (SELECT COALESCE(SUM(amount), 0) FROM payment_installments WHERE enrollment_id = e.enrollment_id) AS suma_cuotas
    FROM enrollments e WHERE e.enrollment_id = $1`, [ID]).then(r => r.rows[0])

console.log('antes  ->', await conReintento(estado))

await conReintento(() => pool.query(`
  WITH cuotas AS (
    SELECT COALESCE(SUM(amount), 0)::numeric AS total
      FROM payment_installments WHERE enrollment_id = $1
  )
  UPDATE enrollments e
     SET total_amount    = cuotas.total,
         discount_amount = GREATEST(0, COALESCE(e.list_price, 0) - cuotas.total)
    FROM cuotas
   WHERE e.enrollment_id = $1
     AND e.total_amount IS DISTINCT FROM cuotas.total`, [ID]))

console.log('despues->', await conReintento(estado))

// El panel FICO lee la cabecera de la matview, no de la tabla: sin refresh el
// cambio no se ve en pantalla.
await conReintento(() => pool.query('REFRESH MATERIALIZED VIEW public.mv_enrollment_report_system'))
console.log('matview refrescada')

await pool.end()
