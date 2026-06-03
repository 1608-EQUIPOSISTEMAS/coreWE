import { pool } from '../../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../../shared/db/sp.js'
import { STUDENT_EMAIL_SQL, STUDENT_PHONE_SQL } from '../../../utils/student-contacts.sql.js'

// Persistencia del subdominio de convalidaciones y estructura padre-hijo.
// Envuelve pool.query y el SP sp_edition_tree_get; no contiene reglas de negocio
// (esas viven en validation.entity.js) ni efectos externos (Odoo/email).
// El SQL se conserva verbatim del service legacy (mismas queries, parametros,
// orden y statementTimeoutMs).
export class ValidationRepository {
  constructor (db = pool, sp = callProcedureReturningRows) {
    this.db = db
    this.sp = sp
  }

  async findParent (enrollmentId) {
    const { rows } = await this.db.query(
      'SELECT enrollment_id, program_version_id, program_edition_id FROM enrollments WHERE enrollment_id = $1',
      [enrollmentId]
    )
    return rows?.[0] || null
  }

  async findChildrenStructure (programVersionId) {
    const { rows } = await this.db.query(`
    SELECT pvs.child_program_version_id, pvs.sort_order, pv.abbreviation AS child_name
      FROM program_version_structure pvs
      JOIN program_versions pv ON pv.program_version_id = pvs.child_program_version_id
     WHERE pvs.parent_program_version_id = $1
     ORDER BY pvs.sort_order
  `, [programVersionId])
    return rows || []
  }

  // Devuelve los hijos del arbol de la edicion del padre. Best-effort: si el SP
  // falla o no hay edicion, devuelve [] para que el flujo trate al padre como E0.
  async getEditionTreeChildren (parentEditionId) {
    if (!parentEditionId) return []
    const treeRows = await this.sp(this.db, 'public.sp_edition_tree_get', [parentEditionId], { statementTimeoutMs: 15000 }).catch(() => [])
    return treeRows?.[0]?.children || []
  }

  async getValidations (enrollmentId) {
    const { rows } = await this.db.query(`
    SELECT ev.*, pv.abbreviation as child_name
    FROM enrollment_validations ev
    JOIN program_versions pv ON pv.program_version_id = ev.child_version_id
    WHERE ev.enrollment_id = $1
    ORDER BY ev.validation_id
  `, [enrollmentId])
    return rows
  }

  async deleteValidations (enrollmentId) {
    await this.db.query('DELETE FROM enrollment_validations WHERE enrollment_id = $1', [enrollmentId])
  }

  async insertValidation ({ enrollmentId, childVersionId, validationType, customEditionId, notes, userId }) {
    await this.db.query(`
      INSERT INTO enrollment_validations (enrollment_id, child_version_id, validation_type, custom_edition_id, notes, status, requested_by)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6)
    `, [enrollmentId, childVersionId, validationType || 'same_edition', customEditionId || null, notes || null, userId])
  }

  async getProgramChildren (programVersionId) {
    const { rows } = await this.db.query(`
    SELECT pvs.child_program_version_id, pvs.sort_order,
           pv.abbreviation as child_name,
           (SELECT jsonb_agg(jsonb_build_object('edition_id', pe.edition_num_id, 'code', pe.global_code, 'start_date', pe.start_date))
            FROM program_editions pe WHERE pe.program_version_id = pvs.child_program_version_id AND pe.active = 'Y'
           ) as editions
    FROM program_version_structure pvs
    JOIN program_versions pv ON pv.program_version_id = pvs.child_program_version_id
    WHERE pvs.parent_program_version_id = $1
    ORDER BY pvs.sort_order
  `, [programVersionId])
    return rows
  }

  // Datos completos del padre necesarios para construir los INSERTs de hijos SEG.
  async findParentDataForChildEnroll (enrollmentId) {
    const { rows } = await this.db.query(`
    SELECT e.enrollment_id, e.customer_id, e.program_version_id, e.program_edition_id,
           e.cat_currency, e.cat_inscription_modality, e.cat_payment_channel, e.cat_payment_plan,
           e.cat_profile_id, e.seller_agent_id,
           per.first_name, per.last_name, per.document_number, per.cat_type_document,
           ${STUDENT_EMAIL_SQL} AS origin_email,
           ${STUDENT_PHONE_SQL} AS origin_phone,
           l.cat_code_country,
           pv.abbreviation AS parent_program_name,
           pe.global_code AS parent_edition_code
    FROM enrollments e
    JOIN customers cust ON cust.customer_id = e.customer_id
    JOIN persons per ON per.person_id = cust.person_id
    LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    WHERE e.enrollment_id = $1
  `, [enrollmentId])
    return rows?.[0] || null
  }

  // Marca el padre como E0: sin edicion, para que el sync de Odoo lo trate como
  // "no inscribir el padre" y los hijos vayan individualmente.
  async clearParentEdition (enrollmentId) {
    await this.db.query(
      'UPDATE enrollments SET program_edition_id = NULL WHERE enrollment_id = $1',
      [enrollmentId]
    )
  }

  async findParentAttachments (enrollmentId) {
    const { rows } = await this.db.query(
      `SELECT file_url AS url, file_url AS name FROM enrollment_attachments WHERE enrollment_id = $1 AND active = 'Y'`,
      [enrollmentId]
    ).catch(() => ({ rows: [] }))
    return rows
  }

  // Crea el enrollment hijo SEG. seller_agent_id=NULL y agent_origin='SA': FICO
  // nunca figura como vendedor de los modulos de seguimiento.
  async insertChildEnrollment ({
    customerId, childPvId, editionId, parentEnrollmentId,
    catCurrency, catInscriptionModality, catPaymentChannel, catPaymentPlan,
    checkedCatId, segCatId, certCatId, catProfileId, userId, notes
  }) {
    const { rows } = await this.db.query(`
        INSERT INTO enrollments (
          customer_id, program_version_id, program_edition_id,
          parent_enrollment_id, total_amount, discount_amount, list_price,
          cat_currency, cat_inscription_modality, cat_payment_channel, cat_payment_plan,
          cat_fico_status, cat_type_status, cat_certificate_status, cat_profile_id,
          seller_agent_id, agent_origin, active, user_registration_id, registration_date,
          notes
        ) VALUES (
          $1, $2, $3,
          $4, 0, 0, 0,
          $5, $6, $7, $8,
          $9, $10, $11, $14,
          NULL, 'SA', 'Y', $12, NOW(),
          $13
        ) RETURNING enrollment_id
      `, [
      customerId, childPvId, editionId,
      parentEnrollmentId,
      catCurrency, catInscriptionModality, catPaymentChannel, catPaymentPlan,
      checkedCatId || null, segCatId || null, certCatId || null,
      userId || 9,
      notes,
      catProfileId
    ])
    return rows?.[0]?.enrollment_id || null
  }
}

export const validationRepository = new ValidationRepository()
