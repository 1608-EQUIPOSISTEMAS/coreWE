import { pool } from '../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../shared/db/sp.js'
import { attachEventCategory } from '../../shared/event-category.js'

// Persistencia del dominio comercial. Envuelve los stored procedures
// sp_comercial_* y el SQL directo de leads, inscripciones y busquedas que el
// service legacy ejecutaba inline.
export class ComercialRepository {
  constructor (db = pool, sp = callProcedureReturningRows) {
    this.db = db
    this.sp = sp
  }

  async leadRegister (person, lead, contact_attempts, user_id) {
    const rows = await this.sp(
      this.db,
      'public.sp_comercial_lead_register',
      [
        JSON.stringify(person || {}),
        JSON.stringify(lead || {}),
        JSON.stringify(contact_attempts || []),
        user_id
      ],
      { statementTimeoutMs: 25000 }
    )
    return rows?.[0] || { result: 0, message: 'No response from DB', response: null }
  }

  async leadUpdate (id, lead, user_id, contact_attempts) {
    const rows = await this.sp(
      this.db,
      'public.sp_comercial_lead_update',
      [
        id,
        JSON.stringify(lead || {}),
        user_id,
        JSON.stringify(contact_attempts || [])
      ],
      { statementTimeoutMs: 25000 }
    )
    return rows?.[0] || { result: 0, message: 'No response from DB', response: null }
  }

  async leadGet (id) {
    const rows = await this.sp(
      this.db,
      'public.sp_comercial_lead_get',
      [id],
      { statementTimeoutMs: 25000 }
    )
    return rows?.[0] || {}
  }

  async leadList (filters) {
    return this.sp(
      this.db,
      'public.sp_comercial_lead_list',
      [JSON.stringify(filters)],
      { statementTimeoutMs: 25000 }
    )
  }

  async leadStats (filters) {
    const query = `CALL public.sp_comercial_lead_stats($1, $2)`
    const res = await this.db.query(query, [JSON.stringify(filters), null])
    return res.rows[0].p_stats
  }

  // Listado distinto de celulares de origen para alimentar el filtro de la columna
  // Cel. Origen del DataTable. Trae todos los celulares historicos con su owner.
  async sellerPhones () {
    const sql = `
    SELECT DISTINCT
      TRIM(l.origin_seller_phone) AS phone,
      u.alias AS owner
    FROM public.leads l
    LEFT JOIN public.users u ON u.user_id = l.user_registration_id
    WHERE l.origin_seller_phone IS NOT NULL
      AND TRIM(l.origin_seller_phone) <> ''
    ORDER BY u.alias NULLS LAST, phone
  `
    const { rows } = await this.db.query(sql)
    return rows
  }

  async enrollmentRegister (lead_id, user_id, payload) {
    const rows = await this.sp(
      this.db,
      'public.sp_comercial_enrollment_register',
      [
        lead_id,
        user_id,
        JSON.stringify(payload)
      ],
      { statementTimeoutMs: 25000 }
    )
    const res = rows?.[0] || { result: 0, message: 'No response from DB', enrollment_id: null }

    // ponytail: la categoria de entrada se escribe con un UPDATE aparte en vez
    // de meterla dentro de sp_comercial_enrollment_register. Es un campo suelto
    // que no participa de ningun calculo del SP, y asi no hay que reescribir un
    // procedimiento grande. Si algun dia el SP necesita leerla, mover el campo
    // al JSON y borrar esto.
    // No revierte la inscripcion si falla: la venta ya quedo registrada y el
    // dato es de reporte. Queda en log para poder corregirlo.
    if (res.result === 1 && res.enrollment_id && payload?.inscription?.cat_event_category) {
      try {
        await this.db.query(
          'UPDATE public.enrollments SET cat_event_category = $1 WHERE enrollment_id = $2',
          [payload.inscription.cat_event_category, res.enrollment_id]
        )
      } catch (err) {
        console.error('[enrollmentRegister] no se pudo guardar cat_event_category:', err.message)
      }
    }
    return res
  }

  async enrollmentGet (enrollment_id) {
    const rows = await this.sp(
      this.db,
      'public.sp_comercial_enrollment_get',
      [enrollment_id],
      { statementTimeoutMs: 5000 }
    )
    const row = rows?.[0] || {}
    // El SP no conoce cat_event_category: se resuelve aparte.
    if (!row.enrollment_id) row.enrollment_id = Number(enrollment_id) || null
    await attachEventCategory([row], this.db)
    return row
  }

  // Estado observado previo de la inscripcion del lead, para distinguir una
  // subsanacion (re-registro) de un alta nueva antes de llamar al SP.
  async leadFicoStatusAlias (lead_id) {
    const prev = await this.db.query(
      `SELECT c.alias AS fico_alias
         FROM public.leads l
         JOIN public.enrollments e ON e.enrollment_id = l.enrollment_id
         LEFT JOIN public."catalog" c ON c.catalog_id = e.cat_fico_status
        WHERE l.lead_id = $1`,
      [lead_id]
    )
    return prev.rows?.[0]?.fico_alias
  }

  async insertResubmitAudit (enrollment_id, user_id) {
    await this.db.query(
      `INSERT INTO public.enrollment_audit_log (enrollment_id, action, performed_by, details)
             VALUES ($1, 'resubmitted', $2, $3)`,
      [enrollment_id, user_id, 'Inscripción subsanada y reenviada a FICO (re-registro de datos corregidos)']
    )
  }

  async resubmitSlackData (enrollment_id) {
    const { rows: ed } = await this.db.query(
      `SELECT CONCAT(per.first_name, ' ', per.last_name) AS student_name,
                    pv.abbreviation AS program_name,
                    pe.global_code  AS edition_code,
                    pe.start_date   AS edition_start_date,
                    ua.alias        AS advisor_alias
               FROM public.enrollments e
               JOIN public.customers cust ON cust.customer_id = e.customer_id
               JOIN public.persons per    ON per.person_id    = cust.person_id
               LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
               LEFT JOIN public.program_editions pe ON pe.edition_num_id      = e.program_edition_id
               LEFT JOIN public.users ua            ON ua.user_id            = e.seller_agent_id
              WHERE e.enrollment_id = $1`,
      [enrollment_id]
    )
    return ed?.[0] || null
  }

  async insertEnrollmentValidation (enrollment_id, childId, validationType, customEdId, notes, user_id) {
    await this.db.query(`
              INSERT INTO enrollment_validations (enrollment_id, child_version_id, validation_type, custom_edition_id, notes, status, requested_by)
              VALUES ($1, $2, $3, $4, $5, 'pending', $6)
            `, [enrollment_id, childId, validationType, customEdId, notes, user_id])
  }

  async insertValidationRequestedAudit (enrollment_id, user_id, details) {
    await this.db.query(`
            INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, details)
            VALUES ($1, 'validation_requested', $2, $3)
          `, [enrollment_id, user_id, details])
  }

  async catalogAliasById (catalogId) {
    const channelRows = await this.db.query(
      `SELECT alias FROM public.catalog WHERE catalog_id = $1 LIMIT 1`,
      [catalogId]
    )
    return channelRows.rows?.[0]?.alias
  }

  // Persiste las URLs de los adjuntos de la matricula. Arma el UPDATE dinamico
  // segun que adjuntos llegaron, igual que el flujo legacy.
  async updateAttachments (enrollment_id, { paymentUrl, studentUrl }) {
    if (!paymentUrl && !studentUrl) return
    let query = 'UPDATE public.enrollments SET '
    const params = []
    let idx = 1

    if (paymentUrl) { query += `payment_attachment = $${idx++}, `; params.push(paymentUrl) }
    if (studentUrl) { query += `student_attachment = $${idx++}, `; params.push(studentUrl) }

    query = query.slice(0, -2) + ` WHERE enrollment_id = $${idx}`
    params.push(enrollment_id)

    await this.db.query(query, params)
  }

  async searchPhoneGet (phone) {
    const rows = await this.sp(
      this.db,
      'public.sp_search_phone_get',
      [
        phone
      ],
      { statementTimeoutMs: 5000 }
    )
    return rows?.[0] || {}
  }

  async searchContact (phone) {
    const query = 'SELECT public.fn_search_contact_by_phone($1) as result'
    const { rows } = await this.db.query(query, [phone])
    return rows[0]?.result || { status: 'error', message: 'No data returned' }
  }

  async userRestrictionsList (payload) {
    const rows = await this.sp(
      this.db,
      'public.sp_comercial_user_restrictions_list',
      [JSON.stringify(payload)]
    )
    return rows || []
  }

  async userRestrictionsUpdate (payloadArray) {
    await this.db.query(
      'CALL public.sp_comercial_user_restrictions_update($1::jsonb)',
      [JSON.stringify(payloadArray)]
    )
  }

  // Listado de versiones de programa. Fuente real del endpoint /programVersionlist
  // (sp_program_version_list), que en el codigo legacy llamaba a una funcion
  // inexistente y reventaba en runtime.
  async programVersionList ({
    program_id,
    activeParam,
    q,
    cat_type_program,
    cat_category,
    cat_model_modality,
    program_version_id,
    page,
    size
  }) {
    return this.sp(
      this.db,
      'public.sp_program_version_list',
      [
        program_id,
        activeParam,
        q,
        cat_type_program,
        cat_category,
        cat_model_modality,
        program_version_id,
        page,
        size
      ],
      { statementTimeoutMs: 25000 }
    )
  }

  // Listado de ediciones. Fuente real del endpoint /editionlist (sp_edition_list),
  // que en el codigo legacy llamaba a una funcion inexistente y reventaba.
  async editionList (filters) {
    return this.sp(
      this.db,
      'public.sp_edition_list',
      [JSON.stringify(filters)],
      { statementTimeoutMs: 25000 }
    )
  }
}

export const comercialRepository = new ComercialRepository()
