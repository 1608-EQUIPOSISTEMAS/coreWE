import { pool } from '../../../shared/db/pool.js'
import { STUDENT_EMAIL_SQL, STUDENT_PHONE_SQL } from '../../../utils/student-contacts.sql.js'

// Persistencia del sync Odoo de inscripciones. Envuelve pool.query con las
// mismas consultas, parametros y orden que tenia fico.service.js. No contiene
// reglas de negocio (esas viven en odoo-sync.entity.js) ni efectos Odoo.
export class OdooSyncRepository {
  constructor (db = pool) {
    this.db = db
  }

  // Datos para el skip de E0 padre: edicion programada y conteo de hijos.
  async findE0Check (enrollmentId) {
    const { rows } = await this.db.query(`
    SELECT e.program_edition_id,
           (SELECT COUNT(*) FROM program_version_structure
             WHERE parent_program_version_id = e.program_version_id)::INT AS children_count
      FROM enrollments e
     WHERE e.enrollment_id = $1
  `, [enrollmentId])
    return rows?.[0] || null
  }

  // Pre-check de idempotencia/membresia: trae flag de membresia y los ids Odoo
  // ya guardados para decidir early-return.
  async findPreCheck (enrollmentId) {
    const { rows } = await this.db.query(`
    SELECT pv.abbreviation, prog.is_membership,
           e.odoo_order_id, e.odoo_user_id, e.odoo_student_id, e.odoo_email
    FROM enrollments e
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN programs prog ON prog.program_id = pv.program_id
    WHERE e.enrollment_id = $1
  `, [enrollmentId])
    return rows?.[0] || null
  }

  // Datos del alumno, programa y edicion para sincronizar con Odoo.
  async findEnrollmentForSync (enrollmentId) {
    const { rows } = await this.db.query(`
    SELECT e.enrollment_id, e.program_edition_id,
           per.first_name, per.last_name, per.mother_last_name, per.document_number,
           ${STUDENT_EMAIL_SQL} AS origin_email,
           ${STUDENT_PHONE_SQL} AS origin_phone,
           prog.odoo_activation,
           prog.cat_model_modality,
           pe.start_date
    FROM enrollments e
    JOIN customers cust ON cust.customer_id = e.customer_id
    JOIN persons per ON per.person_id = cust.person_id
    LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
    LEFT JOIN program_versions ver ON ver.program_version_id = e.program_version_id
    LEFT JOIN programs prog ON prog.program_id = ver.program_id
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    WHERE e.enrollment_id = $1
  `, [enrollmentId])
    return rows?.[0] || null
  }

  // Ultimo odoo_user_id mapeado para el mismo DNI en cualquier inscripcion.
  async findPrevOdooUser (documentNumber) {
    const { rows } = await this.db.query(`
    SELECT e.odoo_user_id FROM enrollments e
    JOIN customers c ON c.customer_id = e.customer_id
    JOIN persons p ON p.person_id = c.person_id
    WHERE p.document_number = $1 AND e.odoo_user_id IS NOT NULL
    ORDER BY e.enrollment_id DESC LIMIT 1
  `, [documentNumber])
    return rows?.[0] || null
  }

  // Persiste los identificadores Odoo del alumno en el enrollment tras el sync.
  async updateOdooUser ({ enrollmentId, odooUserId, odooStudentId, passwordSet, odooEmail }) {
    await this.db.query(`
    UPDATE enrollments SET
      odoo_user_id = $1,
      odoo_student_id = $2,
      odoo_password = $3,
      odoo_email = $5
    WHERE enrollment_id = $4
  `, [odooUserId, odooStudentId, passwordSet || null, enrollmentId, odooEmail])
  }

  // Cuotas planificadas (excluye la inicial) ordenadas por numero.
  async findInstallments (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT installment_number, amount, due_date FROM payment_installments
      WHERE enrollment_id = $1 AND installment_number > 0 ORDER BY installment_number
    `, [enrollmentId])
    return rows
  }

  // Montos del enrollment y alias de moneda para construir la orden de venta.
  async findEnrollmentAmounts (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT e.total_amount, e.discount_amount, e.list_price, c.alias AS currency_alias
      FROM enrollments e
      LEFT JOIN catalog c ON c.catalog_id = e.cat_currency
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  // Guarda el id de la orden de venta Odoo creada.
  async updateOdooOrderId (enrollmentId, orderId) {
    await this.db.query(`UPDATE enrollments SET odoo_order_id = $1 WHERE enrollment_id = $2`, [orderId, enrollmentId])
  }

  // Datos para el sync de pago de cuota: ids Odoo, modalidad y fecha de edicion.
  async findInstallmentSyncData (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT e.odoo_user_id, e.odoo_order_id,
             pv.abbreviation, prog.odoo_activation, prog.is_membership, pe.start_date
      FROM enrollments e
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN programs prog ON prog.program_id = pv.program_id
      LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  // Registro en la bitacora de auditoria del enrollment. Best-effort: un fallo
  // de auditoria no debe romper el sync.
  async logAudit ({ enrollmentId, action, userId, justificacion = null, changes = null, details = null }) {
    try {
      await this.db.query(`
      INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
    `, [enrollmentId, action, userId, justificacion, changes ? JSON.stringify(changes) : null, details])
    } catch (err) {
      console.error('[AuditLog] Error:', err.message)
    }
  }
}

export const odooSyncRepository = new OdooSyncRepository()
