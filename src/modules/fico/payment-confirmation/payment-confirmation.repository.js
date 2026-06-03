import { pool } from '../../../shared/db/pool.js'
import { MEMBERSHIP_ACTIVATION_WINDOW_MONTHS } from './payment-confirmation.entity.js'

// Persistencia de la confirmacion de pago. Envuelve pool.query y el SP
// sp_fico_confirm_payment. No contiene reglas de negocio (viven en la entity)
// ni efectos externos Odoo/email (los orquesta el usecase via puertos). El SQL
// se movio VERBATIM del service legacy: mismas queries, mismos parametros.
export class PaymentConfirmationRepository {
  constructor (db = pool) {
    this.db = db
  }

  // Estado actual de la cuota objetivo del action, para el guard de idempotencia.
  // Devuelve el alias de catalog del estado o null si la cuota no existe.
  async findInstallmentStatusAlias (enrollmentId, installmentNumber) {
    const { rows } = await this.db.query(`
      SELECT c.alias AS status_alias
        FROM payment_installments pi
        LEFT JOIN catalog c ON c.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = $1 AND pi.installment_number = $2
       LIMIT 1
    `, [enrollmentId, installmentNumber])
    return rows?.[0]?.status_alias ?? null
  }

  // Lee si el programa del enrollment es membresia (no confiamos en flags del
  // frontend). Devuelve { abbreviation, is_membership } o null.
  async findMembershipProbe (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT pv.abbreviation, prog.is_membership
      FROM enrollments e
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN programs prog ON prog.program_id = pv.program_id
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] ?? null
  }

  // Calcula en TZ Lima los hechos de la fecha de activacion: si es hoy o pasado,
  // si excede la ventana, el runAt (9am Lima) y la fecha normalizada. Toda la
  // aritmetica vive en SQL porque la TZ del servidor en prod no es confiable.
  async computeActivationFacts (rawDate) {
    const { rows } = await this.db.query(`
      SELECT
        ($1::date <= (NOW() AT TIME ZONE 'America/Lima')::date)                                            AS is_today_or_past,
        ($1::date > ((NOW() AT TIME ZONE 'America/Lima')::date + ($2 || ' months')::interval)::date)      AS out_of_window,
        (($1::date + TIME '09:00:00') AT TIME ZONE 'America/Lima')                                         AS run_at,
        $1::date                                                                                            AS activation_date
    `, [rawDate, String(MEMBERSHIP_ACTIVATION_WINDOW_MONTHS)])
    return rows?.[0] ?? null
  }

  // Max payment_id activo ANTES del SP. Sirve para identificar el placeholder
  // obsoleto (todo payment con id <= este valor es previo al pago real).
  async findPrevMaxPaymentId (enrollmentId) {
    const { rows } = await this.db.query(
      "SELECT COALESCE(MAX(payment_id), 0) AS max_id FROM payments WHERE enrollment_id = $1 AND active = 'Y'",
      [enrollmentId]
    )
    return Number(rows?.[0]?.max_id) || 0
  }

  // Ejecuta el SP que graba el pago real. Devuelve { result, message, ... }.
  async confirmPaymentSp (payload) {
    const { rows } = await this.db.query(
      'SELECT * FROM public.sp_fico_confirm_payment($1::jsonb)',
      [JSON.stringify(payload)]
    )
    return rows?.[0] || { result: 0, message: 'Sin respuesta' }
  }

  // Desactiva el placeholder obsoleto: payment cat_payment_type=3113 sin
  // transaction_code y con id <= prevMaxPayId. Su payment_date desplazaba el
  // pago real en el historial y su monto distorsionaba el calculo de PAGADO.
  async deactivateObsoletePlaceholder (enrollmentId, prevMaxPayId) {
    await this.db.query(
      `UPDATE payments
          SET active = 'N'
        WHERE enrollment_id = $1
          AND payment_id <= $2
          AND active = 'Y'
          AND cat_payment_type = 3113
          AND COALESCE(NULLIF(TRIM(transaction_code), ''), NULL) IS NULL`,
      [enrollmentId, prevMaxPayId]
    )
  }

  // Sincroniza leads.pay_date con la fecha real que FICO acaba de registrar.
  // sp_fico_enrollment_list usa la cascada leads.pay_date -> payments.payment_date
  // -> registration_date, y leads.pay_date gana.
  async syncLeadPayDate (enrollmentId, payDate, userId) {
    await this.db.query(
      `UPDATE leads SET pay_date = $2::date, user_modification_id = $3
        WHERE enrollment_id = $1`,
      [enrollmentId, payDate, userId || 9]
    )
  }

  // Marca el token de pago como confirmado (si no lo estaba ya).
  async markPaymentTokenConfirmed (enrollmentId, userId) {
    await this.db.query(
      "UPDATE payment_tokens SET status = 'confirmed', confirmed_by = $1, updated_at = NOW() WHERE enrollment_id = $2 AND status != 'confirmed'",
      [userId, enrollmentId]
    )
  }

  // Persiste la fecha de activacion de la membresia (caso inmediato o diferido).
  async persistMembershipActivationDate (enrollmentId, activationDate) {
    await this.db.query(
      `UPDATE enrollments SET membership_activation_date = $2::date WHERE enrollment_id = $1`,
      [enrollmentId, activationDate]
    )
  }
}

export const paymentConfirmationRepository = new PaymentConfirmationRepository()
