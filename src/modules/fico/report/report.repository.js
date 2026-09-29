import { pool } from '../../../shared/db/pool.js'
import { INSTALLMENT_EXCLUDED_STATUSES, INSTALLMENT_PENDING_STATUSES, MOVED_ENROLLMENT_STATUSES } from '../../dashboard/results/fico.repository.js'

const INSTALLMENT_PAID_STATUSES = [2471, 4454] // pagado (legacy), pagada
// Montos en soles: 3042 = dolares, al mismo tipo fijo 3.75 del panel FICO.
const inSoles = (column) => `${column} * CASE WHEN e.cat_currency = 3042 THEN 3.75 ELSE 1 END`
// La cuota que vence el dia de la venta (o el siguiente) es la inicial o el
// contado: se cobra al vender. En la BD la N.1 casi siempre es esa, asi que el
// numero de cuota no sirve para separarlas; la fecha si.
const IS_DEFERRED = 'pi.due_date > e.registration_date::date + 1'

export class FicoReportRepository {
  constructor (db = pool) {
    this.db = db
  }

  // Cuotas que vencen en el rango, con su ultimo pago: la cuota se completa
  // cuando llega el ultimo (la detraccion es una segunda fila de payments).
  async installmentsDue ({ from, to }) {
    const { rows } = await this.db.query(`
      WITH pago AS (
        SELECT installment_id, MAX(payment_date)::date AS fecha
          FROM payments
         WHERE active = 'Y' AND installment_id IS NOT NULL
         GROUP BY 1
      )
      SELECT e.customer_id,
             to_char(pi.due_date, 'YYYY-MM-DD') AS vence,
             (${inSoles('pi.amount')})::float8 AS soles,
             pi.cat_status = ANY($3::int[]) AS pagada,
             to_char(p.fecha, 'YYYY-MM-DD') AS pagada_el
        FROM payment_installments pi
        JOIN enrollments e ON e.enrollment_id = pi.enrollment_id
        LEFT JOIN pago p ON p.installment_id = pi.installment_id
       WHERE e.active = 'Y'
         AND COALESCE(e.cat_type_status, 0) <> ALL($4::int[])
         AND pi.cat_status <> ALL($5::int[])
         AND ${IS_DEFERRED}
         AND pi.due_date BETWEEN $1 AND $2`,
    [from, to, INSTALLMENT_PAID_STATUSES, MOVED_ENROLLMENT_STATUSES, INSTALLMENT_EXCLUDED_STATUSES])
    return rows
  }

  // Foto de HOY, no del periodo: toda cuota pendiente (vencida o por vencer),
  // para la antiguedad de la deuda y la cobranza proyectada.
  async pendingInstallments () {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id, e.customer_id,
             TRIM(concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS alumno,
             to_char(pi.due_date, 'YYYY-MM-DD') AS vence,
             (${inSoles('pi.amount')})::float8 AS soles
        FROM payment_installments pi
        JOIN enrollments e ON e.enrollment_id = pi.enrollment_id
        JOIN customers cu ON cu.customer_id = e.customer_id
        JOIN persons per ON per.person_id = cu.person_id
       WHERE e.active = 'Y'
         AND COALESCE(e.cat_type_status, 0) <> ALL($1::int[])
         AND pi.cat_status = ANY($2::int[])
         AND ${IS_DEFERRED}`,
    [MOVED_ENROLLMENT_STATUSES, INSTALLMENT_PENDING_STATUSES])
    return rows
  }

  // Todo lo que entro en el rango (ventas y cuotas) por medio de pago.
  async collectedByMethod ({ from, to }) {
    const { rows } = await this.db.query(`
      SELECT pm.alias, pm.description AS medio,
             COUNT(*)::int AS pagos,
             SUM(${inSoles('p.amount')})::float8 AS soles
        FROM payments p
        JOIN enrollments e ON e.enrollment_id = p.enrollment_id
        LEFT JOIN catalog pm ON pm.catalog_id = p.cat_method_payment
       WHERE p.active = 'Y' AND e.active = 'Y'
         AND p.payment_date >= $1 AND p.payment_date < $2::date + 1
       GROUP BY 1, 2`, [from, to])
    return rows
  }

  // Lo cobrado por dia de pago. Aqui no se excluyen ventas retiradas ni
  // reprogramadas: la plata que entro, entro.
  async collectedByDay ({ from, to }) {
    const { rows } = await this.db.query(`
      SELECT to_char(p.payment_date, 'YYYY-MM-DD') AS dia,
             SUM(${inSoles('p.amount')})::float8 AS soles
        FROM payments p
        JOIN payment_installments pi ON pi.installment_id = p.installment_id
        JOIN enrollments e ON e.enrollment_id = p.enrollment_id
       WHERE p.active = 'Y' AND e.active = 'Y'
         AND ${IS_DEFERRED}
         AND p.payment_date >= $1 AND p.payment_date < $2::date + 1
       GROUP BY 1`, [from, to])
    return rows
  }
}

export const ficoReportRepository = new FicoReportRepository()
