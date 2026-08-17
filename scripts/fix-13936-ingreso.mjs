// 13936 (sergio.cristobal.soto@gmail.com): el ingreso quedo en S/290.50 por un
// error de tipeo al registrar. FICO pide corregirlo a S/291.00.
//
// El monto vive replicado en tres filas y las tres tienen que moverse juntas o
// el panel muestra una cuota "Pagada" por un monto distinto al pago real:
//   enrollments.total_amount -> payment_installments.amount -> payments.amount
// No hay saldo pendiente (unica cuota, ya pagada), asi que los 0.50 suben el
// total: no hay de donde descontarlos.
//
// Idempotente: los UPDATE filtran por el monto viejo, y la entrada de auditoria
// solo se inserta si no existe ya.
//   node scripts/fix-13936-ingreso.mjs [--dry]
import { pool } from './db.mjs'

const ID = 13936
const DE = 290.50
const A = 291.00
const USER_ID = 9 // ADMIN: la correccion la ejecuta sistema a pedido de FICO
const JUSTIFICACION = 'Correccion de monto de ingreso solicitada por el area de FICO: error de registro, el ingreso conforme es S/291.00'
const DRY = process.argv.includes('--dry')

const cli = await pool.connect()
try {
  await cli.query('BEGIN')

  const { rowCount: nEnr } = await cli.query(
    'UPDATE enrollments SET total_amount = $2, user_modification_id = $3, modification_date = NOW() WHERE enrollment_id = $1 AND total_amount = $4',
    [ID, A, USER_ID, DE]
  )
  const { rowCount: nCuota } = await cli.query(
    'UPDATE payment_installments SET amount = $2 WHERE enrollment_id = $1 AND amount = $3',
    [ID, A, DE]
  )
  const { rowCount: nPago } = await cli.query(
    "UPDATE payments SET amount = $2 WHERE enrollment_id = $1 AND amount = $3 AND active = 'Y'",
    [ID, A, DE]
  )
  console.log(`filas movidas -> enrollment: ${nEnr}, cuota: ${nCuota}, pago: ${nPago}`)

  const { rowCount: yaAuditado } = await cli.query(
    "SELECT 1 FROM enrollment_audit_log WHERE enrollment_id = $1 AND action = 'edited' AND justificacion = $2",
    [ID, JUSTIFICACION]
  )
  if (yaAuditado) {
    console.log('auditoria ya registrada -> no se duplica')
  } else {
    await cli.query(
      `INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
       VALUES ($1, 'edited', $2, $3, $4::jsonb, $5)`,
      [ID, USER_ID, JUSTIFICACION,
        JSON.stringify({
          total_amount: { de: DE, a: A },
          'payments.amount': { de: DE, a: A },
          'payment_installments.amount': { de: DE, a: A }
        }),
        `Ingreso corregido de S/${DE.toFixed(2)} a S/${A.toFixed(2)} a solicitud del area de FICO (error de registro)`]
    )
    console.log('auditoria registrada')
  }

  await cli.query(DRY ? 'ROLLBACK' : 'COMMIT')
  console.log(DRY ? '--dry: revertido' : 'COMMIT ok')
} catch (err) {
  await cli.query('ROLLBACK')
  throw err
} finally {
  cli.release()
}

if (!DRY) {
  await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_enrollment_report_system')
  console.log('matview refrescada')
}

const { rows } = await pool.query(`
  SELECT e.total_amount, i.amount AS cuota, p.amount AS pago, ci.description AS estado_cuota
    FROM enrollments e
    LEFT JOIN payment_installments i ON i.enrollment_id = e.enrollment_id
    LEFT JOIN payments p ON p.installment_id = i.installment_id AND p.active = 'Y'
    LEFT JOIN catalog ci ON ci.catalog_id = i.cat_status
   WHERE e.enrollment_id = $1`, [ID])
console.table(rows)

const { rows: audit } = await pool.query(
  "SELECT action, performed_at, justificacion, details FROM enrollment_audit_log WHERE enrollment_id = $1 ORDER BY performed_at DESC LIMIT 3", [ID]
)
console.table(audit)

await pool.end()
