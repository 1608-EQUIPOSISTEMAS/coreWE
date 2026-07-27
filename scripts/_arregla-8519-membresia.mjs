// One-off: enrollment 8519 — membresia WE BLACK (WE-MB-04) de CLAUDIO SERGIO VILCHES
// BRINGAS (DNI 7874901). La migracion masiva lo dejo en 0 y con una cuota de
// cortesia: se reconstruye contra la hoja FICO (fila venta + fila cobranzas).
//
// Lectura del bloque de control: inicial 390 | saldo 486 | pagado 2.174 | ACT |
// total 2.660 | 9 cuotas. Cierra dos veces: 390 + 8x223 = 2.174 pagado, y
// 2.174 + 486 = 2.660 total. La ultima cuota absorbe la diferencia (486 en vez
// de 223), mismo patron que el 4543 (ver memoria correccion-enrollments-importados).
//
// Idempotente: borra cuotas/pagos previos del enrollment y los reinserta.
import { writeFileSync } from 'node:fs'
import { pool } from './db.mjs'

const ENR = 8519
const TOTAL = 2660
const ACTIVACION = '2025-11-26'

const PAGADA = 4454, PENDIENTE = 2470
const TRANSF = 3203, YAPE = 3205
const WEE = 6 // WE Educacion BCP PEN
const WEL = 12 // WE Education latam BCP PEN

// n, monto, vencimiento, [fecha_pago, medio, cuenta, codigo] -> sin el 4to = pendiente
const CUOTAS = [
  [0, 390, '2025-11-26', ['2025-11-26', YAPE, WEE, '9542653']],
  [1, 223, '2025-12-26', ['2025-12-26', TRANSF, WEL, null]],
  [2, 223, '2026-01-26', ['2026-01-28', YAPE, WEE, '23369436']],
  [3, 223, '2026-02-26', ['2026-02-26', TRANSF, WEL, '7844651935469']],
  [4, 223, '2026-03-26', ['2026-03-27', TRANSF, WEL, '7844651982995']],
  [5, 223, '2026-04-26', ['2026-04-27', TRANSF, WEL, '7844651923392']],
  [6, 223, '2026-05-26', ['2026-05-21', TRANSF, WEL, '7844651977450']],
  [7, 223, '2026-06-26', ['2026-06-24', TRANSF, WEL, '2395311']],
  [8, 223, '2026-07-26', ['2026-07-25', TRANSF, WEL, '7844651977182']],
  [9, 486, '2026-08-26', null]
]

const suma = CUOTAS.reduce((a, c) => a + c[1], 0)
if (suma !== TOTAL) throw new Error(`cuotas suman ${suma} != total ${TOTAL}`)

const cli = await pool.connect() // ponytail: una sola conexion, el tunel se cae seguido
try {
  const dump = {}
  for (const [k, sql] of [
    ['enrollment', 'SELECT * FROM enrollments WHERE enrollment_id = $1'],
    ['installments', 'SELECT * FROM payment_installments WHERE enrollment_id = $1'],
    ['payments', 'SELECT * FROM payments WHERE enrollment_id = $1']
  ]) dump[k] = (await cli.query(sql, [ENR])).rows
  writeFileSync(new URL('./_backup_8519.json', import.meta.url), JSON.stringify(dump, null, 2))
  console.log('respaldo -> _backup_8519.json')

  await cli.query('BEGIN')

  await cli.query(`
    UPDATE enrollments SET
      total_amount = $2, list_price = $2, discount_amount = 0,
      cat_payment_plan = 2467,          -- Cuotas
      cat_currency = 3041,              -- SOLES
      cat_type_status = 3100,           -- ACT
      membership_program_id = 167,      -- WE BLACK
      membership_activation_date = $3::date,
      seller_agent_id = 3, agent_origin = NULL,   -- CA36 = CAMILO
      modification_date = now()
     WHERE enrollment_id = $1`, [ENR, TOTAL, ACTIVACION])

  await cli.query('DELETE FROM payments WHERE enrollment_id = $1', [ENR])
  await cli.query('DELETE FROM payment_installments WHERE enrollment_id = $1', [ENR])

  for (const [n, monto, vence, pago] of CUOTAS) {
    const { rows: [ins] } = await cli.query(`
      INSERT INTO payment_installments (enrollment_id, installment_number, amount, due_date, cat_status)
      VALUES ($1, $2, $3, $4::date, $5) RETURNING installment_id`,
    [ENR, n, monto, vence, pago ? PAGADA : PENDIENTE])
    if (!pago) continue
    const [fecha, medio, cuenta, codigo] = pago
    await cli.query(`
      INSERT INTO payments (enrollment_id, installment_id, amount, payment_date, transaction_code,
                            cat_method_payment, cat_payment_type, cat_settlement_status,
                            settled_in_account_id, active, user_registration_id)
      VALUES ($1, $2, $3, $4::date, $5, $6, 3115, 2573, $7, 'Y', 9)`,
    [ENR, ins.installment_id, monto, fecha, codigo, medio, cuenta])
  }

  const { rows: [chk] } = await cli.query(`
    SELECT e.total_amount::numeric AS total,
           (SELECT sum(amount) FROM payment_installments WHERE enrollment_id = $1) AS suma_cuotas,
           (SELECT sum(amount) FROM payments WHERE enrollment_id = $1 AND active = 'Y') AS pagado
      FROM enrollments e WHERE e.enrollment_id = $1`, [ENR])
  if (Number(chk.total) !== Number(chk.suma_cuotas)) throw new Error(`descuadre: ${JSON.stringify(chk)}`)
  await cli.query('COMMIT')
  console.log('sanity:', chk, '| saldo:', Number(chk.total) - Number(chk.pagado))

  console.table((await cli.query(`
    SELECT i.installment_number AS n, i.amount, i.due_date::date AS vence,
           c.description AS estado, p.payment_date::date AS pagado_el,
           cm.description AS medio, p.settled_in_account_id AS cuenta, p.transaction_code AS cod
      FROM payment_installments i
      LEFT JOIN catalog c ON c.catalog_id = i.cat_status
      LEFT JOIN payments p ON p.installment_id = i.installment_id
      LEFT JOIN catalog cm ON cm.catalog_id = p.cat_method_payment
     WHERE i.enrollment_id = $1 ORDER BY i.installment_number`, [ENR])).rows)
} catch (e) {
  await cli.query('ROLLBACK').catch(() => {})
  throw e
} finally {
  cli.release()
}

await pool.query('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')
console.log('matview refrescada')
await pool.end()
