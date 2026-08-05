// 15905 (destino de CC desde 3589) pasa de "Al contado" a "Cuotas" y se le
// agrega una cuota de S/136.00 con vencimiento 15/09/2026.
//
// La cuota #1 (S/0.00 Pagada) NO se toca: es la marca del CC, el dinero se pago
// en el origen. La nueva va como #2 pendiente. El total sube a 136 porque si no
// el panel FICO / mv_enrollment_report_system muestran una cuota pendiente
// contra un total de 0.
//
// Idempotente: si la cuota de 136 al 2026-09-15 ya existe, no la duplica.
//   node scripts/fix-15905-cuotas.mjs [--dry]
import { pool } from './db.mjs'

const ID = 15905
const MONTO = 136
const VENCE = '2026-09-15'
const PLAN_CUOTAS = 2467 // we_payment_way_installments
const CUOTA_PENDIENTE = 2470 // we_payment_status_pending
const USER_ID = 9
const DRY = process.argv.includes('--dry')

const cli = await pool.connect()
try {
  await cli.query('BEGIN')

  const { rows: [ya] } = await cli.query(
    `SELECT installment_id FROM payment_installments
      WHERE enrollment_id = $1 AND amount = $2 AND due_date = $3::date`,
    [ID, MONTO, VENCE]
  )

  if (ya) {
    console.log('cuota ya existe (installment_id', ya.installment_id, ') -> no se duplica')
  } else {
    const { rows: [ins] } = await cli.query(
      `INSERT INTO payment_installments (enrollment_id, installment_number, amount, due_date, cat_status)
       SELECT $1, COALESCE(MAX(installment_number), 0) + 1, $2, $3::date, $4
         FROM payment_installments WHERE enrollment_id = $1
       RETURNING installment_id, installment_number`,
      [ID, MONTO, VENCE, CUOTA_PENDIENTE]
    )
    console.log('cuota creada:', ins)
  }

  const { rows: [upd] } = await cli.query(
    `UPDATE enrollments
        SET cat_payment_plan = $2,
            total_amount = GREATEST(total_amount, $3),
            list_price   = GREATEST(list_price, $3)
      WHERE enrollment_id = $1
      RETURNING cat_payment_plan, list_price, discount_amount, total_amount`,
    [ID, PLAN_CUOTAS, MONTO]
  )
  console.log('enrollment:', upd)

  await cli.query(
    `INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
     VALUES ($1, 'installments_rescheduled', $2, $3, $4::jsonb, $5)`,
    [ID, USER_ID, 'Conversion a cuotas + cobro pendiente del cambio de curso',
      JSON.stringify({ cat_payment_plan: { de: 2466, a: PLAN_CUOTAS }, total_amount: { de: 0, a: MONTO } }),
      `Cuota de S/${MONTO}.00 con vencimiento ${VENCE}`]
  )

  await cli.query(DRY ? 'ROLLBACK' : 'COMMIT')
  console.log(DRY ? '--dry: revertido' : 'COMMIT ok')
} catch (err) {
  await cli.query('ROLLBACK')
  throw err
} finally {
  cli.release()
}

const { rows } = await pool.query(
  `SELECT i.installment_number, i.amount, i.due_date, c.description AS estado
     FROM payment_installments i LEFT JOIN catalog c ON c.catalog_id = i.cat_status
    WHERE i.enrollment_id = $1 ORDER BY i.installment_number`, [ID]
)
console.table(rows)

await pool.end()
