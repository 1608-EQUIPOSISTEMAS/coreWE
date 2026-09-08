import { pool } from '../../../shared/db/pool.js'
import { STUDENT_EMAIL_SQL } from '../../../utils/student-contacts.sql.js'

// Persistencia de los correos transaccionales FICO. Envuelve pool.query; no
// contiene reglas de negocio (esas viven en email-confirmation.entity.js) ni
// efectos externos (Odoo/email/PDF). Las credenciales SAP se guardan por upsert
// con los valores que FICO ingresa a mano (ya no se autogeneran).
export class EmailConfirmationRepository {
  constructor (db = pool) {
    this.db = db
  }

  // Datos minimos para decidir membresia y si falta odoo_user_id.
  async findMembershipCheck (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT pv.abbreviation, prog.is_membership, e.odoo_user_id
      FROM enrollments e
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN programs prog ON prog.program_id = pv.program_id
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  // Variante de findMembershipCheck usada por el preview (no necesita odoo_user_id).
  // programVersionId permite previsualizar contra otro programa (cambio de curso).
  async findPreviewMembershipCheck (enrollmentId, programVersionId = null) {
    const { rows } = await this.db.query(`
      SELECT pv.abbreviation, prog.is_membership FROM enrollments e
      LEFT JOIN program_versions pv ON pv.program_version_id = COALESCE($2::integer, e.program_version_id)
      LEFT JOIN programs prog ON prog.program_id = pv.program_id
      WHERE e.enrollment_id = $1
    `, [enrollmentId, programVersionId])
    return rows?.[0] || null
  }

  // Datos completos para construir el correo de confirmacion (preview).
  // programVersionId override: el cambio de curso previsualiza el correo con el
  // programa destino antes de que el enrollment nuevo exista.
  async findConfirmationDataForPreview (enrollmentId, editionId, programVersionId = null) {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id, e.total_amount, e.discount_amount,
             per.first_name, per.last_name, per.mother_last_name, per.document_number,
             ${STUDENT_EMAIL_SQL} AS origin_email,
             pv.abbreviation AS program_name,
             COALESCE(NULLIF(pe.banner_link, ''), prog.banner_link) AS banner_link,
             pe.edition_num_id,
             pe.banner_mime,
             (pe.banner_image IS NOT NULL) AS has_banner_image,
             prog.cat_model_modality,
             prog.cat_category,
             prog.cat_type_program,
             c_type.alias AS program_type_alias,
             e.cat_event_category,
             e.event_seat,
             c_evt.alias AS event_category_alias,
             c_evt.description AS event_category_label,
             ecp.whatsapp_link AS event_whatsapp_link,
             pe.certificate_form_link,
             pe.business_card_link,
             pe.session_detail_virtual,
             pe.session_detail_onsite,
             pe.start_date, pe.whatsapp_link,
             curr.variable_2 AS currency_symbol,
             e.odoo_user_id,
             e.odoo_email,
             e.odoo_password,
             c_plan.alias AS payment_plan_alias
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cust.person_id
      LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN program_versions pv ON pv.program_version_id = COALESCE($3::integer, e.program_version_id)
      LEFT JOIN programs prog ON prog.program_id = pv.program_id
      LEFT JOIN program_editions pe ON pe.edition_num_id = COALESCE($2::integer, e.program_edition_id)
      LEFT JOIN catalog curr ON e.cat_currency = curr.catalog_id
      LEFT JOIN catalog c_type ON c_type.catalog_id = prog.cat_type_program
      LEFT JOIN catalog c_evt ON c_evt.catalog_id = e.cat_event_category
      LEFT JOIN event_category_prices ecp
             ON ecp.program_version_id = pv.program_version_id
            AND ecp.cat_event_category = e.cat_event_category
      LEFT JOIN catalog c_plan ON c_plan.catalog_id = e.cat_payment_plan
      WHERE e.enrollment_id = $1
    `, [enrollmentId, editionId, programVersionId])
    return rows?.[0] || null
  }

  // Datos completos para enviar el correo de confirmacion (incluye email_cc).
  async findConfirmationDataForSend (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id, e.total_amount, e.discount_amount,
             per.first_name, per.last_name, per.mother_last_name, per.document_number,
             ${STUDENT_EMAIL_SQL} AS origin_email,
             pv.abbreviation AS program_name,
             COALESCE(NULLIF(pe.banner_link, ''), prog.banner_link) AS banner_link,
             pe.edition_num_id,
             pe.banner_mime,
             (pe.banner_image IS NOT NULL) AS has_banner_image,
             prog.cat_model_modality,
             prog.cat_category,
             prog.cat_type_program,
             c_type.alias AS program_type_alias,
             e.cat_event_category,
             e.event_seat,
             c_evt.alias AS event_category_alias,
             c_evt.description AS event_category_label,
             ecp.whatsapp_link AS event_whatsapp_link,
             pe.certificate_form_link,
             pe.business_card_link,
             pe.session_detail_virtual,
             pe.session_detail_onsite,
             pe.start_date,
             pe.whatsapp_link,
             curr.variable_2 AS currency_symbol,
             e.odoo_user_id,
             e.odoo_email,
             e.odoo_password,
             e.email_cc,
             c_plan.alias AS payment_plan_alias
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cust.person_id
      LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN programs prog ON prog.program_id = pv.program_id
      LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      LEFT JOIN catalog curr ON e.cat_currency = curr.catalog_id
      LEFT JOIN catalog c_type ON c_type.catalog_id = prog.cat_type_program
      LEFT JOIN catalog c_evt ON c_evt.catalog_id = e.cat_event_category
      LEFT JOIN event_category_prices ecp
             ON ecp.program_version_id = pv.program_version_id
            AND ecp.cat_event_category = e.cat_event_category
      LEFT JOIN catalog c_plan ON c_plan.catalog_id = e.cat_payment_plan
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  // Bytes del banner de una edicion. Query aparte a proposito: el bytea pesa
  // cientos de KB y no debe viajar en la consulta que arma TODOS los correos,
  // solo cuando hace falta incrustarlo.
  async findEditionBanner (editionId) {
    if (!editionId) return null
    const { rows } = await this.db.query(
      `SELECT banner_image, banner_mime
         FROM public.program_editions
        WHERE edition_num_id = $1 AND banner_image IS NOT NULL`,
      [editionId]
    )
    return rows?.[0] || null
  }

  // Datos para preview/envio de correo de membresia.
  async findMembershipDataForPreview (enrollmentId, editionId, programVersionId = null) {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id, per.first_name, per.last_name, per.mother_last_name, per.document_number,
             ${STUDENT_EMAIL_SQL} AS origin_email,
             pv.abbreviation AS program_name,
             pe.start_date, e.odoo_user_id, e.odoo_email, e.odoo_password,
             e.membership_activation_date,
             curr.variable_2 AS currency_symbol,
             c_plan.alias AS payment_plan_alias
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cust.person_id
      LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN program_versions pv ON pv.program_version_id = COALESCE($3::integer, e.program_version_id)
      LEFT JOIN program_editions pe ON pe.edition_num_id = COALESCE($2::integer, e.program_edition_id)
      LEFT JOIN catalog curr ON e.cat_currency = curr.catalog_id
      LEFT JOIN catalog c_plan ON c_plan.catalog_id = e.cat_payment_plan
      WHERE e.enrollment_id = $1
    `, [enrollmentId, editionId, programVersionId])
    return rows?.[0] || null
  }

  async findMembershipDataForSend (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id, per.first_name, per.last_name, per.mother_last_name,
             ${STUDENT_EMAIL_SQL} AS origin_email,
             pv.abbreviation AS program_name,
             pe.start_date, e.odoo_user_id, e.odoo_email, e.odoo_password,
             e.membership_activation_date, e.email_cc,
             curr.variable_2 AS currency_symbol,
             c_plan.alias AS payment_plan_alias
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cust.person_id
      LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      LEFT JOIN catalog curr ON e.cat_currency = curr.catalog_id
      LEFT JOIN catalog c_plan ON c_plan.catalog_id = e.cat_payment_plan
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  // Datos para el correo de confirmacion de cuota.
  async findPaymentConfirmationData (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id,
             per.first_name, per.last_name,
             ${STUDENT_EMAIL_SQL} AS origin_email,
             pv.abbreviation AS program_name,
             curr.variable_2 AS currency_symbol,
             c_cat.description AS category_description,
             e.email_cc
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cust.person_id
      LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN programs prog ON prog.program_id = pv.program_id
      LEFT JOIN catalog curr ON e.cat_currency = curr.catalog_id
      LEFT JOIN catalog c_cat ON c_cat.catalog_id = prog.cat_category
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  // Correo en copia: se persiste el CC que FICO confirmo en el preview para que
  // los envios posteriores (cuota, membresia, RP heredado) lo hereden.
  async saveEmailCc (enrollmentId, ccJoined) {
    await this.db.query(
      'UPDATE public.enrollments SET email_cc = $1 WHERE enrollment_id = $2',
      [ccJoined, enrollmentId]
    )
  }

  // Flag que levanta comercial al mandar la venta: bloquea el envio sin CC.
  async requiresEmailCc (enrollmentId) {
    const { rows } = await this.db.query(
      'SELECT requires_email_cc FROM public.enrollments WHERE enrollment_id = $1',
      [enrollmentId]
    )
    return rows?.[0]?.requires_email_cc === true
  }

  // Credenciales SAP que el operador ingreso a mano, persistidas como registro
  // de lo enviado (upsert: un reenvio reemplaza lo anterior). Ya no se
  // autogeneran; vienen siempre del formulario de FICO.
  async setSapCredentials (enrollmentId, sapUsername, sapPassword) {
    const { rows } = await this.db.query(`
      INSERT INTO public.enrollment_sap_credentials (enrollment_id, sap_username, sap_password)
      VALUES ($1, $2, $3)
      ON CONFLICT (enrollment_id) DO UPDATE
        SET sap_username = EXCLUDED.sap_username,
            sap_password = EXCLUDED.sap_password,
            updated_at   = now()
      RETURNING sap_username, sap_password
    `, [enrollmentId, sapUsername, sapPassword])
    return rows?.[0] || null
  }

  // Credenciales ya persistidas. El reenvio y el correo que dispara la cola no
  // vuelven a pedirlas por formulario: sin esta lectura, un curso SAP online
  // salia con el correo completo pero SIN el bloque de credenciales, en silencio.
  async findSapCredentials (enrollmentId) {
    const { rows } = await this.db.query(
      'SELECT sap_username, sap_password FROM public.enrollment_sap_credentials WHERE enrollment_id = $1',
      [enrollmentId]
    )
    return rows?.[0] || null
  }

  // Horario de la edicion (override opcional). Para preview se pasa editionId;
  // para envio se resuelve la edicion del enrollment.
  async findScheduleForPreview (enrollmentId, editionId) {
    const { rows } = await this.db.query(`
      SELECT c.description AS day_name, es.start_time, es.end_time
      FROM edition_schedules es
      LEFT JOIN catalog c ON es.cat_day_id = c.catalog_id
      WHERE es.edition_num_id = COALESCE($2::integer, (SELECT program_edition_id FROM enrollments WHERE enrollment_id = $1))
      ORDER BY es.schedule_id
    `, [enrollmentId, editionId])
    return rows || []
  }

  async findScheduleForSend (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT c.description AS day_name, es.start_time, es.end_time
      FROM edition_schedules es
      LEFT JOIN catalog c ON es.cat_day_id = c.catalog_id
      WHERE es.edition_num_id = (SELECT program_edition_id FROM enrollments WHERE enrollment_id = $1)
      ORDER BY es.schedule_id
    `, [enrollmentId])
    return rows || []
  }

  // Cuotas (installment_number > 0) para construir el cronograma del correo.
  // ponytail: se excluyen las de monto 0 (destino de CC/RP arrastra un pago 0
  // como cuota); una cuota de S/. 0.00 no le dice nada al alumno.
  async findInstallments (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT installment_number, amount, due_date
      FROM payment_installments WHERE enrollment_id = $1 AND installment_number > 0 AND amount > 0 ORDER BY installment_number
    `, [enrollmentId])
    return rows || []
  }

  // Cuotas con estado para el correo de progreso de pago.
  // paid_at = fecha REAL del pago (la que digita FICO al confirmar), no la de
  // vencimiento. El correo de ultima cuota anunciaba el due_date, asi que a quien
  // pagaba tarde le llegaba una fecha que no era la suya.
  //
  // Casteado a ::date a proposito: payment_date es timestamp y la plantilla
  // formatea con getters UTC, asi que un pago de la noche en Lima se imprimiria
  // un dia despues. LATERAL con LIMIT 1 porque una cuota con detraccion tiene dos
  // filas de payments (mismo dia, distinto tipo).
  async findInstallmentsWithStatus (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT pi.installment_number, pi.amount, pi.due_date, c.alias AS status_alias,
             pay.paid_at
      FROM payment_installments pi
      LEFT JOIN catalog c ON c.catalog_id = pi.cat_status
      LEFT JOIN LATERAL (
        SELECT p.payment_date::date AS paid_at
        FROM public.payments p
        WHERE p.installment_id = pi.installment_id AND p.active = 'Y'
        ORDER BY p.payment_date DESC, p.payment_id DESC
        LIMIT 1
      ) pay ON true
      WHERE pi.enrollment_id = $1 AND pi.installment_number > 0
      ORDER BY pi.installment_number
    `, [enrollmentId])
    return rows || []
  }

  // True si ya hubo un envio exitoso del template indicado para este enrollment.
  async hasPriorSuccessfulSend (enrollmentId, templateType) {
    const { rows } = await this.db.query(`
      SELECT 1 FROM public.email_logs
      WHERE enrollment_id = $1 AND template_type = $2 AND status = 'sent'
      LIMIT 1
    `, [enrollmentId, templateType])
    return !!rows?.[0]
  }

  // True si el correo ya salio DESPUES de `since`. Lo usa el job de membresia
  // para no duplicar un envio que otro camino (reenvio manual de FICO, o un
  // frontend viejo que todavia dispara el correo) ya hizo mientras esperaba turno.
  async hasSuccessfulSendSince (enrollmentId, templateType, since) {
    const { rows } = await this.db.query(`
      SELECT 1 FROM public.email_logs
      WHERE enrollment_id = $1 AND template_type = $2 AND status = 'sent'
        AND sent_at >= $3
      LIMIT 1
    `, [enrollmentId, templateType, since])
    return !!rows?.[0]
  }

  // True si el mismo customer tiene otro enrollment ya creado en Odoo.
  async hasPriorOdooEnrollment (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT 1
      FROM enrollments e
      WHERE e.customer_id = (SELECT customer_id FROM enrollments WHERE enrollment_id = $1)
        AND e.enrollment_id <> $1
        AND e.odoo_user_id IS NOT NULL
      LIMIT 1
    `, [enrollmentId])
    return !!rows?.[0]
  }

  // True si el enrollment pertenece a un programa padre (tiene hijos en la
  // estructura). Los padres ocultan WhatsApp y adjuntan PDF de cronograma.
  async isParentProgram (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT 1 FROM program_version_structure pvs
      JOIN enrollments e ON e.program_version_id = pvs.parent_program_version_id
      WHERE e.enrollment_id = $1
      LIMIT 1
    `, [enrollmentId])
    return rows.length > 0
  }

  // Registro en email_logs tras intentar el envio.
  async insertEmailLog ({ enrollmentId, toEmail, subject, messageId, templateType, status }) {
    await this.db.query(`
      INSERT INTO public.email_logs (enrollment_id, to_email, subject, message_id, template_type, status)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [enrollmentId, toEmail, subject, messageId || null, templateType, status])
  }

  // Timeline de correos del enrollment para la UI.
  async findEmailLogs (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT email_log_id, to_email, subject, template_type, status,
             sent_at, delivered_at, opened_at, clicked_at, bounced_at,
             open_count, click_count, bounce_reason
      FROM public.email_logs
      WHERE enrollment_id = $1
      ORDER BY sent_at DESC
    `, [enrollmentId])
    return rows || []
  }

  // Audit log generico (mismas columnas que el logAudit del service legacy).
  async logAudit ({ enrollmentId, action, userId = null, justificacion = null, changes = null, details = null }) {
    try {
      await this.db.query(`
        INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      `, [enrollmentId, action, userId, justificacion, changes ? JSON.stringify(changes) : null, details])
    } catch (err) {
      console.error('[AuditLog] Error:', err.message)
    }
  }

  // Limpia los fallos previos antes de un reenvio manual: borra rows
  // email_failed del audit log y email_logs con status='failed'. Mantiene la
  // timeline limpia y deja isFirstSend consistente.
  async clearPriorEmailFailures (enrollmentId) {
    try {
      await this.db.query(
        "DELETE FROM enrollment_audit_log WHERE enrollment_id = $1 AND action = 'email_failed'",
        [enrollmentId]
      )
      await this.db.query(
        "DELETE FROM email_logs WHERE enrollment_id = $1 AND status = 'failed'",
        [enrollmentId]
      )
    } catch (err) {
      console.error('[clearPriorEmailFailures]', err.message)
    }
  }
}

export const emailConfirmationRepository = new EmailConfirmationRepository()
