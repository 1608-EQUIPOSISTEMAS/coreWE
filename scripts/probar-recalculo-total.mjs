// Prueba en la BD LOCAL que editar el monto de una cuota realinea la cabecera
// del enrollment (total_amount y discount_amount). Reproduce el caso 16394:
// cuotas 80 + 248 = 328 contra un total_amount de 410.
//
// Corre dentro de una transaccion con ROLLBACK: no deja rastro.
import pg from 'pg'
import { EnrollmentRepository } from '../src/modules/fico/enrollment/enrollment.repository.js'

const pool = new pg.Pool({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/system_erp_dev',
  max: 2, connectionTimeoutMillis: 10000
})

const cliente = await pool.connect()
try {
  await cliente.query('BEGIN')

  // El repo recibe el cliente de la transaccion para que todo caiga en el ROLLBACK.
  const repo = new EnrollmentRepository(cliente)
  const id = 16394

  await cliente.query(
    'UPDATE enrollments SET total_amount = 410, discount_amount = 410, list_price = 820 WHERE enrollment_id = $1', [id])
  // Las cuotas no se recrean: hay pagos que las referencian por FK. Se ajusta
  // el monto, que es justo lo que hace FICO con el lapiz de la ficha.
  await cliente.query(
    'UPDATE payment_installments SET amount = 248 WHERE enrollment_id = $1 AND installment_number = 1', [id])
  await cliente.query(
    'UPDATE payment_installments SET amount = 80 WHERE enrollment_id = $1 AND installment_number = 0', [id])

  const antes = (await cliente.query(
    'SELECT total_amount, discount_amount, list_price FROM enrollments WHERE enrollment_id = $1', [id])).rows[0]
  console.log('antes  ->', antes)

  const recalc = await repo.recalcTotalsFromInstallments(id)
  console.log('recalc ->', recalc)

  const despues = (await cliente.query(
    'SELECT total_amount, discount_amount, list_price FROM enrollments WHERE enrollment_id = $1', [id])).rows[0]
  console.log('despues->', despues)

  const ok = Number(despues.total_amount) === 328 &&
             Number(despues.discount_amount) === 492 &&
             Number(despues.list_price) === 820 &&
             recalc?.old === 410 && recalc?.new === 328
  console.log(ok ? 'OK total 328, descuento 492, lista 820 intacta' : 'FALLA')

  // Segunda pasada: ya alineado, no debe reportar cambio (idempotente).
  const repetido = await repo.recalcTotalsFromInstallments(id)
  console.log(repetido === null ? 'OK idempotente (segunda pasada no cambia nada)' : 'FALLA idempotencia: ' + JSON.stringify(repetido))
} finally {
  await cliente.query('ROLLBACK')
  cliente.release()
  await pool.end()
  // Importar el repositorio arranca el cron de la matview, la cola de jobs y
  // los adaptadores de Odoo/Slack: sin esto el proceso queda vivo para siempre.
  process.exit(0)
}
