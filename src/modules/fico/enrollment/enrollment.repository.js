import { pool, withTransaction } from '../../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../../shared/db/sp.js'
import { ALIAS } from '../../../utils/catalog-aliases.js'
import { getCatalogIdByAlias } from '../../../utils/catalog-helper.js'
import { STUDENT_EMAIL_SQL, STUDENT_PHONE_SQL } from '../../../utils/student-contacts.sql.js'
import { getEnrollmentOdoo, getProgramPrice as queryProgramPrice } from '../../../utils/fico-queries.sql.js'
import { buildOdooEmailBase } from '../../../utils/fico-odoo.helper.js'
import { MEMBERSHIP_ACTIVATION_WINDOW_MONTHS } from './enrollment.entity.js'

// Efectos cruzados que todavia viven en el service legacy porque pertenecen a
// otros subdominios (audit, confirmacion, hijos, membresia, odoo, MV refresh,
// cola). El usecase los dispara EXACTAMENTE como el legacy: mismos puntos,
// mismo caracter sincrono/asincrono. Se reapuntaran cuando esos subdominios
// migren. Importados perezosamente para no acoplar el modulo a su orden de carga.
import { refreshEnrollmentMv, forceRefreshEnrollmentMv } from '../../../services/fico-mv-refresh.cron.js'
import { enqueue as enqueueJob, getLatestJobByEnrollment } from '../../../services/job-queue.service.js'
import { odoo } from '../../../shared/adapters/odoo/odoo.adapter.js'
import slackClient from '../../../config/slack.js'
import { parseEmailCc } from '../../../utils/email-cc.js'

// Puertos de efectos cruzados de otros subdominios FICO (audit/odoo/email/hijos),
// cableados por el composition root (fico.bootstrap.js). logAudit es best-effort
// (no-op por defecto, como el legacy); el resto lanza si no se inyecto.
const _ports = {
  logAudit: async () => {},
  enrollInOdoo: async () => { throw new Error('enrollInOdoo no inyectado en enrollment.repository (falta fico.bootstrap)') },
  sendConfirmationEmail: async () => { throw new Error('sendConfirmationEmail no inyectado en enrollment.repository (falta fico.bootstrap)') },
  createChildEnrollments: async () => { throw new Error('createChildEnrollments no inyectado en enrollment.repository (falta fico.bootstrap)') }
}

export function setEnrollmentPorts (ports = {}) {
  Object.assign(_ports, ports)
}

// Persistencia y orquestacion de efectos del agregado enrollment. Todo el SQL y
// las llamadas a SP estan movidos VERBATIM desde fico.service.js (mismas
// queries, parametros, orden y statementTimeoutMs). No contiene reglas de
// dominio: esas viven en enrollment.entity.js.
export class EnrollmentRepository {
  constructor (db = pool) {
    this.db = db
  }

  // --- Listado, KPIs, asesores -------------------------------------------

  async listEnrollments (payload = {}) {
    return callProcedureReturningRows(
      pool,
      'public.sp_fico_enrollment_list',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 25000 }
    )
  }

  async kpisDaily ({ today, yesterday }) {
    const { rows } = await this.db.query(
      'SELECT day_label, total, confirmed, pending, amount FROM public.sp_fico_kpis_daily($1::date, $2::date)',
      [today, yesterday]
    )
    return rows
  }

  async advisorsList () {
    const sql = `
      SELECT DISTINCT
        CASE
          WHEN e.agent_origin IS NOT NULL AND u.alias IS NOT NULL
            THEN e.agent_origin || ' - ' || u.alias
          WHEN e.agent_origin IS NOT NULL THEN e.agent_origin
          ELSE u.alias
        END AS seller_agent_name
      FROM public.enrollments e
      LEFT JOIN public.users u ON u.user_id = e.seller_agent_id
      WHERE e.active = 'Y'
        AND (e.agent_origin IS NOT NULL OR u.alias IS NOT NULL)
      ORDER BY 1
    `
    const { rows } = await this.db.query(sql)
    return rows.map(r => r.seller_agent_name).filter(Boolean)
  }

  async bankAccountList () {
    const { rows } = await this.db.query(
      `SELECT account_id, business_entity_catalog_id, bank_name, currency, account_number, cci_number
       FROM public.bank_accounts WHERE active = 'Y' ORDER BY business_entity_catalog_id, bank_name`
    )
    return rows || []
  }

  // --- Detalle de pago ----------------------------------------------------

  async paymentDetailGet (enrollmentId) {
    const rows = await callProcedureReturningRows(
      pool,
      'public.sp_fico_payment_detail_get',
      [enrollmentId],
      { statementTimeoutMs: 25000 }
    )
    return rows?.[0] || null
  }

  async paymentDetailEditionDates (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT pe.start_date AS edition_start_date, pe.end_date AS edition_end_date,
             l.pay_date AS commercial_pay_date,
             e.membership_activation_date,
             cts.alias AS cat_type_status_alias
      FROM enrollments e
      LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  // --- Registro directo + duplicados -------------------------------------

  async findDuplicate ({ programEditionId, doc, mail }) {
    const { rows } = await this.db.query(`
      SELECT
        e.enrollment_id,
        e.registration_date,
        e.agent_origin,
        pv.abbreviation                                     AS program_name,
        pe.global_code                                      AS edition_code,
        per.document_number                                 AS existing_document,
        TRIM(BOTH FROM concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS existing_student_name,
        u_s.alias                                           AS seller_agent_alias
      FROM public.enrollments e
      JOIN public.customers       cust ON cust.customer_id = e.customer_id
      JOIN public.persons         per  ON per.person_id    = cust.person_id
      LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN public.program_editions pe ON pe.edition_num_id     = e.program_edition_id
      LEFT JOIN public.leads             l ON l.enrollment_id        = e.enrollment_id
      LEFT JOIN public.users           u_s ON u_s.user_id            = e.seller_agent_id
      WHERE e.active = 'Y'
        AND e.program_edition_id = $1
        AND (
          ($2::text IS NOT NULL AND per.document_number = $2)
          OR ($3::text IS NOT NULL AND (
            LOWER(COALESCE(l.origin_email, '')) = LOWER($3)
            OR EXISTS (
              SELECT 1
                FROM public.person_contacts pc
                JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact
               WHERE pc.person_id = per.person_id
                 AND c.alias      = 'we_way_contact_email'
                 AND pc.active    = 'Y'
                 AND LOWER(pc.value) = LOWER($3)
            )
          ))
        )
      ORDER BY e.registration_date DESC
      LIMIT 1
    `, [programEditionId, doc, mail])
    return rows?.[0] || null
  }

  async registerDirect ({ userId, inscription }) {
    const rows = await callProcedureReturningRows(
      pool,
      'public.sp_fico_enrollment_register_direct',
      [userId, JSON.stringify({ inscription })],
      { statementTimeoutMs: 25000 }
    )
    return rows?.[0] || { result: 0, message: 'Sin respuesta del SP' }
  }

  async saveEmailCc (enrollmentId, ccArray) {
    await this.db.query(
      'UPDATE enrollments SET email_cc = $1 WHERE enrollment_id = $2',
      [ccArray.join(','), enrollmentId]
    )
  }

  async enqueueRegisterFollowup ({ enrollmentId, userId }) {
    const job = await enqueueJob({
      jobType: 'register_followup',
      enrollmentId,
      payload: { userId }
    })
    return job
  }

  // --- Ediciones / precios -----------------------------------------------

  async getEnrollmentEditionRefs (enrollmentId) {
    const { rows } = await this.db.query(
      'SELECT program_version_id, program_edition_id FROM enrollments WHERE enrollment_id = $1',
      [enrollmentId]
    )
    return rows?.[0] || null
  }

  async listEditionsByVersion (programVersionId) {
    return callProcedureReturningRows(
      pool,
      'public.sp_edition_caller',
      [programVersionId, null, null, null, null, null],
      { statementTimeoutMs: 15000 }
    )
  }

  async getProgramPrice (programVersionId) {
    return queryProgramPrice(programVersionId)
  }

  // --- Reprogramar edicion -----------------------------------------------

  async getReprogramOrigin (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT e.program_edition_id, e.program_version_id,
             pe.global_code AS old_code, pe.start_date AS old_start_date,
             ${STUDENT_EMAIL_SQL} AS origin_email,
             prog.odoo_activation
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cust.person_id
      LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN programs prog ON prog.program_id = pv.program_id
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  async getEditionById (editionId) {
    const { rows } = await this.db.query(`
      SELECT pe.edition_num_id, pe.global_code, pe.start_date, pe.program_version_id
      FROM program_editions pe
      WHERE pe.edition_num_id = $1
    `, [editionId])
    return rows?.[0] || null
  }

  async setProgramEdition (enrollmentId, newEditionId) {
    await this.db.query(
      'UPDATE enrollments SET program_edition_id = $1 WHERE enrollment_id = $2',
      [newEditionId, enrollmentId]
    )
  }

  async setReprogrammedStatus (enrollmentId) {
    const rpCatId = await getCatalogIdByAlias(ALIAS.ENROLLMENT_STATUS_REPROGRAMMED)
    if (rpCatId) {
      await this.db.query(
        'UPDATE enrollments SET cat_type_status = $1 WHERE enrollment_id = $2',
        [rpCatId, enrollmentId]
      )
    } else {
      console.warn('[reprogramEdition] No se encontro catalogo RP')
    }
  }

  async shiftPendingInstallments (enrollmentId, diffDays) {
    const { rows } = await this.db.query(`
      UPDATE payment_installments
      SET due_date = due_date + INTERVAL '${diffDays} days'
      WHERE enrollment_id = $1 AND cat_status NOT IN (4454, 2471)
      RETURNING installment_number, due_date
    `, [enrollmentId])
    return rows
  }

  async clearOdooRefsForReprogram ({ enrollmentId, old, newEd, userId }) {
    if (!old.odoo_activation) return
    try {
      const od = await getEnrollmentOdoo(enrollmentId).catch(() => null)
      if (od?.odoo_user_id) {
        const user = await odoo.searchUserByEmail(old.origin_email)
        if (user?.partner_id?.[0]) {
          const oldGroups = await odoo.searchSlideGroup(old.odoo_activation)
          const oldDate = new Date(old.old_start_date)
          const oldDd = String(oldDate.getDate()).padStart(2, '0')
          const oldMm = String(oldDate.getMonth() + 1).padStart(2, '0')
          const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
          const oldSearchName = `${old.odoo_activation} (${oldDd}/${oldMm}) - ${monthNames[oldDate.getMonth()]} ${oldDate.getFullYear()}`
          const oldMatch = oldGroups.find(g => g.name === oldSearchName)
          if (oldMatch) {
            await odoo.unenrollStudentFromCourse({ partnerId: user.partner_id[0], slideGroupId: oldMatch.id })
            await this.logAudit({ enrollmentId, action: 'odoo_unenrolled', userId, details: `Desinscrito de Odoo: ${oldSearchName}` })
          }
        }
        if (od.odoo_order_id) {
          await odoo.cancelSaleOrder(od.odoo_order_id)
          await this.db.query('UPDATE enrollments SET odoo_order_id = NULL WHERE enrollment_id = $1', [enrollmentId])
        }
        await this.db.query('UPDATE enrollments SET odoo_user_id = NULL, odoo_student_id = NULL WHERE enrollment_id = $1', [enrollmentId])
      }
    } catch (e) { console.error('[reprogramEdition] Error desinscribiendo Odoo:', e.message) }
  }

  // --- Cambio de curso ----------------------------------------------------

  async getCourseChangeOrigin (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id, e.program_version_id, e.program_edition_id,
             e.customer_id, e.seller_agent_id, e.cat_currency,
             e.total_amount, e.discount_amount,
             e.cat_inscription_modality, e.cat_payment_channel, e.cat_payment_plan,
             per.first_name, per.last_name, per.document_number, per.cat_type_document,
             l.lead_id,
             ${STUDENT_EMAIL_SQL} AS origin_email,
             ${STUDENT_PHONE_SQL} AS origin_phone,
             l.cat_code_country,
             pv.abbreviation AS old_program_name,
             prog.odoo_activation AS old_odoo_activation,
             pe.global_code AS old_edition_code, pe.start_date AS old_start_date
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cust.person_id
      LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN programs prog ON prog.program_id = pv.program_id
      LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  async getCourseChangeDestEdition (newEditionId, newProgramVersionId) {
    const { rows } = await this.db.query(`
      SELECT pe.edition_num_id, pe.global_code, pe.start_date,
             pv.abbreviation AS new_program_name, pv.program_version_id
      FROM program_editions pe
      JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
      WHERE pe.edition_num_id = $1 AND pe.program_version_id = $2
    `, [newEditionId, newProgramVersionId])
    return rows?.[0] || null
  }

  async setCourseChangedStatus (enrollmentId) {
    const ccCatId = await getCatalogIdByAlias(ALIAS.ENROLLMENT_STATUS_COURSE_CHANGED)
    if (ccCatId) {
      await this.db.query(
        'UPDATE enrollments SET cat_type_status = $1 WHERE enrollment_id = $2',
        [ccCatId, enrollmentId]
      )
    }
  }

  // Resuelve el metodo de pago a reusar en la nueva venta del CC: el del pago
  // activo mas reciente del origen, o transferencia por defecto.
  async resolveCourseChangeMethod (oldEnrollmentId) {
    const ccContadoCatId = await getCatalogIdByAlias(ALIAS.PAYMENT_WAY_SINGLE)
    const { rows: oldPayment } = await this.db.query(
      `SELECT cat_method_payment FROM payments WHERE enrollment_id = $1 AND active = 'Y' ORDER BY payment_id DESC LIMIT 1`,
      [oldEnrollmentId]
    )
    let methodPayment = oldPayment?.[0]?.cat_method_payment || null
    if (!methodPayment) {
      methodPayment = await getCatalogIdByAlias(ALIAS.PAYMENT_METHOD_TRANSFER)
    }
    return { ccContadoCatId, resolvedMethodPayment: methodPayment }
  }

  // Bloque atomico del cambio de curso: estado FICO del nuevo enrollment,
  // vinculo al padre, ajuste de payment y registro en course_changes.
  async finalizeCourseChange ({ enrollmentId, newEid, old, newProgramVersionId, newEditionId, totalAmount, oldAmount, justificacion, userId, cat_method_payment, cat_business_entity, bank_account_id, transaction_code }) {
    const ccCheckedCatId = await getCatalogIdByAlias(ALIAS.ENROLLMENT_STATUS_CHECKED)
    await withTransaction(async client => {
      if (ccCheckedCatId) {
        await client.query('UPDATE enrollments SET cat_fico_status = $1 WHERE enrollment_id = $2', [ccCheckedCatId, newEid])
      }
      await client.query(
        'UPDATE enrollments SET parent_enrollment_id = $1 WHERE enrollment_id = $2',
        [enrollmentId, newEid]
      )

      const payUpdates = []
      const payParams = []
      let pIdx = 1
      if (cat_business_entity) { payUpdates.push(`settled_in_account_id = $${pIdx}`); payParams.push(bank_account_id); pIdx++ }
      if (cat_method_payment) { payUpdates.push(`cat_method_payment = $${pIdx}`); payParams.push(cat_method_payment); pIdx++ }
      if (transaction_code) { payUpdates.push(`transaction_code = $${pIdx}`); payParams.push(transaction_code); pIdx++ }
      if (payUpdates.length > 0) {
        payParams.push(newEid)
        await client.query(
          `UPDATE payments SET ${payUpdates.join(', ')} WHERE enrollment_id = $${pIdx} AND active = 'Y'`,
          payParams
        )
      }

      await client.query(`
        INSERT INTO course_changes (
          customer_id, enrollment_origin_id, enrollment_destination_id,
          program_origin_id, program_destination_id,
          edition_origin_id, edition_destination_id,
          amount_origin, amount_destination, amount_difference,
          justificacion, approved_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        old.customer_id, enrollmentId, newEid,
        old.program_version_id, newProgramVersionId,
        old.program_edition_id, newEditionId,
        oldAmount, totalAmount, totalAmount - oldAmount,
        justificacion, userId
      ])
    })
  }

  async unenrollFromOldOdoo ({ enrollmentId, old }) {
    if (!old.old_odoo_activation) return
    try {
      const od = await getEnrollmentOdoo(enrollmentId)
      if (!od?.odoo_user_id) return
      const user = await odoo.searchUserByEmail(old.origin_email)
      if (user?.partner_id?.[0]) {
        const groups = await odoo.searchSlideGroup(old.old_odoo_activation)
        for (const g of (groups || [])) {
          await odoo.unenrollStudentFromCourse({ partnerId: user.partner_id[0], slideGroupId: g.id })
        }
      }
      if (od.odoo_order_id) {
        await odoo.cancelSaleOrder(od.odoo_order_id)
      }
    } catch (e) { console.error('[courseChange][Odoo] unenroll old:', e.message) }
  }

  // --- Snapshot / observar / reenviar ------------------------------------

  async getEnrollmentSnapshot (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT e.total_amount, e.discount_amount, e.list_price,
             ${STUDENT_EMAIL_SQL} AS origin_email,
             ${STUDENT_PHONE_SQL} AS origin_phone,
             per.first_name, per.last_name, per.mother_last_name, per.document_number,
             c_cur.description AS currency,
             c_plan.description AS payment_plan,
             c_prof.description AS profile
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cust.person_id
      LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN catalog c_cur ON c_cur.catalog_id = e.cat_currency
      LEFT JOIN catalog c_plan ON c_plan.catalog_id = e.cat_payment_plan
      LEFT JOIN catalog c_prof ON c_prof.catalog_id = e.cat_profile_id
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    if (!rows?.[0]) return null
    const r = rows[0]
    const { rows: files } = await this.db.query(
      `SELECT file_name, file_url FROM enrollment_attachments WHERE enrollment_id = $1 AND active = 'Y'`,
      [enrollmentId]
    ).catch(() => ({ rows: [] }))
    return {
      alumno: [r.first_name, r.last_name, r.mother_last_name].filter(Boolean).join(' ').trim(),
      documento: r.document_number,
      email: r.origin_email,
      telefono: r.origin_phone,
      precio_lista: r.list_price,
      descuento: r.discount_amount,
      total: r.total_amount,
      moneda: r.currency,
      plan_pago: r.payment_plan,
      perfil: r.profile,
      vouchers: (files || []).map(f => f.file_name).join(', ') || 'Ninguno'
    }
  }

  async getRejectTarget (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id, e.seller_agent_id,
             CONCAT(per.first_name, ' ', per.last_name) AS student_name,
             pv.abbreviation AS program_name,
             pe.global_code AS edition_code,
             pe.start_date AS edition_start_date,
             l.lead_id,
             ua.alias AS advisor_alias
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cust.person_id
      LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      LEFT JOIN users ua ON ua.user_id = e.seller_agent_id
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  async setObservedStatus (enrollmentId) {
    const obsCatId = await getCatalogIdByAlias(ALIAS.ENROLLMENT_STATUS_OBSERVED)
    if (!obsCatId) throw new Error('Catalogo de estado Observado no encontrado')
    await this.db.query(
      'UPDATE enrollments SET cat_fico_status = $1 WHERE enrollment_id = $2',
      [obsCatId, enrollmentId]
    )
    return obsCatId
  }

  async notifyAdvisorObserved ({ sellerAgentId, leadId, studentName, programName, reason }) {
    const title = 'Inscripcion Observada'
    const message = `La inscripcion de ${studentName || '---'} en ${programName || '---'} fue observada: ${reason}`
    await this.db.query(`
      INSERT INTO notifications (user_id, lead_id, title, message)
      VALUES ($1, $2, $3, $4)
    `, [sellerAgentId, leadId || null, title, message])
    await this.db.query(`NOTIFY canal_crm_notificaciones, '${JSON.stringify({ asesor_id: sellerAgentId })}'`)
  }

  async getUserAlias (userId) {
    const { rows } = await this.db.query('SELECT alias FROM users WHERE user_id = $1', [userId])
    return rows?.[0]?.alias || null
  }

  async getResubmitState (enrollmentId) {
    const { rows } = await this.db.query(
      'SELECT cat_fico_status, seller_agent_id FROM enrollments WHERE enrollment_id = $1',
      [enrollmentId]
    )
    return rows?.[0] || null
  }

  async getLastObservedAudit (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT changes FROM enrollment_audit_log
      WHERE enrollment_id = $1 AND action = 'observed'
      ORDER BY performed_at DESC LIMIT 1
    `, [enrollmentId])
    return rows?.[0]?.changes ?? null
  }

  async clearFicoStatus (enrollmentId) {
    await this.db.query(
      'UPDATE enrollments SET cat_fico_status = NULL WHERE enrollment_id = $1',
      [enrollmentId]
    )
  }

  async getResubmitNotice (enrollmentId, userId) {
    const { rows } = await this.db.query(`
      SELECT CONCAT(per.first_name, ' ', per.last_name) AS student_name,
             pv.abbreviation AS program_name,
             pe.global_code AS edition_code,
             pe.start_date AS edition_start_date,
             ua.alias AS advisor_alias
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cust.person_id
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      LEFT JOIN users ua ON ua.user_id = $2
      WHERE e.enrollment_id = $1
    `, [enrollmentId, userId])
    return rows?.[0] || null
  }

  // --- Modalidad / asesor -------------------------------------------------

  async getModalityOrigin (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT e.cat_inscription_modality, c_old.description AS old_modality
      FROM enrollments e
      LEFT JOIN catalog c_old ON c_old.catalog_id = e.cat_inscription_modality
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  async getCatalogDescription (catalogId) {
    const { rows } = await this.db.query('SELECT description FROM catalog WHERE catalog_id = $1', [catalogId])
    return rows?.[0]?.description || null
  }

  async setModality (enrollmentId, newModalityId) {
    await this.db.query(
      'UPDATE enrollments SET cat_inscription_modality = $1 WHERE enrollment_id = $2',
      [newModalityId, enrollmentId]
    )
  }

  async getSellerAgentOrigin (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT
        e.enrollment_id,
        e.seller_agent_id            AS old_agent_id,
        e.agent_origin               AS old_origin,
        u_old.alias                  AS old_alias,
        cf.alias                     AS fico_status_alias
      FROM enrollments e
      LEFT JOIN users u_old ON u_old.user_id = e.seller_agent_id
      LEFT JOIN catalog cf ON cf.catalog_id = e.cat_fico_status
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  async setSellerAgent (enrollmentId, newAgentId, newOrigin) {
    await this.db.query(
      'UPDATE enrollments SET seller_agent_id = $1, agent_origin = $2 WHERE enrollment_id = $3',
      [newAgentId, newOrigin, enrollmentId]
    )
    // La invalidacion de la cache de asesores la hace el usecase editSellerAgent
    // (invalidateAdvisorsCache) tras esta escritura.
  }

  // --- Retiro / eliminacion ----------------------------------------------

  async getRetireTarget (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id,
             CONCAT(per.first_name, ' ', per.last_name) AS student_name,
             ${STUDENT_PHONE_SQL} AS student_phone,
             pv.abbreviation AS program_name, pe.global_code AS edition_code
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

  async retireParent (enrollmentId, retId) {
    await this.db.query(
      'UPDATE enrollments SET cat_type_status = $1 WHERE enrollment_id = $2',
      [retId, enrollmentId]
    )
    const { rows: cancelledInstallments } = await this.db.query(`
      UPDATE payment_installments SET cat_status = 4456
      WHERE enrollment_id = $1 AND cat_status NOT IN (4454, 2471)
      RETURNING installment_id, installment_number, amount
    `, [enrollmentId])
    return cancelledInstallments
  }

  async getActiveChildren (enrollmentId, retId) {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id, e.program_version_id,
             pv2.abbreviation AS child_program_name,
             pe2.global_code AS edition_code,
             to_char(pe2.start_date, 'DD/MM/YYYY') AS start_date_fmt
      FROM enrollments e
      LEFT JOIN program_versions pv2 ON pv2.program_version_id = e.program_version_id
      LEFT JOIN program_editions pe2 ON pe2.edition_num_id = e.program_edition_id
      WHERE e.parent_enrollment_id = $1 AND e.cat_type_status != $2
    `, [enrollmentId, retId])
    return rows
  }

  async retireChild (childEnrollmentId, retId) {
    await this.db.query('UPDATE enrollments SET cat_type_status = $1 WHERE enrollment_id = $2', [retId, childEnrollmentId])
    await this.db.query(`DELETE FROM payment_installments WHERE enrollment_id = $1 AND cat_status NOT IN (4454, 2471)`, [childEnrollmentId])
  }

  async unenrollOdooOnRetire ({ enrollmentId, userId }) {
    try {
      const { rows: odooData } = await this.db.query(
        `SELECT e.odoo_user_id, e.odoo_order_id,
                ${STUDENT_EMAIL_SQL} AS origin_email,
                prog.odoo_activation
         FROM enrollments e
         JOIN customers cust ON cust.customer_id = e.customer_id
         JOIN persons per ON per.person_id = cust.person_id
         LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
         LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
         LEFT JOIN programs prog ON prog.program_id = pv.program_id
         WHERE e.enrollment_id = $1`, [enrollmentId]
      ).catch(() => ({ rows: [] }))
      const od = odooData?.[0]
      if (od?.odoo_user_id && od?.odoo_activation && od?.origin_email) {
        const user = await odoo.searchUserByEmail(od.origin_email)
        if (user?.partner_id?.[0]) {
          const groups = await odoo.searchSlideGroup(od.odoo_activation)
          for (const g of (groups || [])) {
            await odoo.unenrollStudentFromCourse({ partnerId: user.partner_id[0], slideGroupId: g.id })
          }
        }
        if (od.odoo_order_id) {
          await odoo.cancelSaleOrder(od.odoo_order_id)
        }
        await this.logAudit({ enrollmentId, action: 'odoo_unenrolled', userId, details: `Desinscrito de Odoo por retiro` })
      }
    } catch (e) { console.error('[retireEnrollment] Error desinscribiendo Odoo:', e.message) }
  }

  notifyStudentRetirement (payload) {
    slackClient.notifyStudentRetirement(payload)
  }

  notifyEnrollmentObserved (payload) {
    return slackClient.notifyEnrollmentObserved(payload)
  }

  notifyEnrollmentResubmitted (payload) {
    return slackClient.notifyEnrollmentResubmitted(payload)
  }

  async deleteEnrollmentCascade ({ enrollmentId, userId }) {
    const client = await pool.connect()
    try {
      const { rows: target } = await client.query(
        `SELECT e.enrollment_id,
                CONCAT(per.first_name, ' ', per.last_name) AS student_name,
                per.document_number,
                pv.abbreviation AS program_name,
                pe.global_code AS edition_code
         FROM enrollments e
         JOIN customers cust ON cust.customer_id = e.customer_id
         JOIN persons per ON per.person_id = cust.person_id
         LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
         LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
         WHERE e.enrollment_id = $1`,
        [enrollmentId]
      )
      if (!target?.[0]) throw new Error('Inscripcion no encontrada')

      const { rows: children } = await client.query(
        'SELECT enrollment_id FROM enrollments WHERE parent_enrollment_id = $1',
        [enrollmentId]
      )
      const allIds = [enrollmentId, ...children.map(r => r.enrollment_id)]

      await client.query('BEGIN')

      await client.query('DELETE FROM payments WHERE enrollment_id = ANY($1::int[])', [allIds])
      await client.query('DELETE FROM payment_installments WHERE enrollment_id = ANY($1::int[])', [allIds])
      await client.query('DELETE FROM enrollment_validations WHERE enrollment_id = ANY($1::int[])', [allIds])
      await client.query('DELETE FROM enrollment_attachments WHERE enrollment_id = ANY($1::int[])', [allIds])
      await client.query('DELETE FROM enrollment_audit_log WHERE enrollment_id = ANY($1::int[])', [allIds])
      await client.query('DELETE FROM email_logs WHERE enrollment_id = ANY($1::int[])', [allIds])
      await client.query('DELETE FROM payment_tokens WHERE enrollment_id = ANY($1::int[])', [allIds])

      await client.query(
        `UPDATE leads
            SET enrollment_id = NULL,
                cat_status_lead = COALESCE(
                  (SELECT catalog_id FROM catalog WHERE alias = 'we_lead_status_atendido' LIMIT 1),
                  cat_status_lead
                )
          WHERE enrollment_id = ANY($1::int[])`,
        [allIds]
      )

      if (children.length > 0) {
        await client.query(
          'DELETE FROM enrollments WHERE enrollment_id = ANY($1::int[])',
          [children.map(r => r.enrollment_id)]
        )
      }
      const { rowCount } = await client.query(
        'DELETE FROM enrollments WHERE enrollment_id = $1',
        [enrollmentId]
      )

      await client.query('COMMIT')

      console.warn(
        `[deleteEnrollment] HARD DELETE userId=${userId} enrollmentId=${enrollmentId} ` +
        `student="${target[0].student_name}" doc=${target[0].document_number || '---'} ` +
        `program="${target[0].program_name || '---'} ${target[0].edition_code || ''}" ` +
        `children=${children.length}`
      )

      refreshEnrollmentMv('on-delete')

      return {
        result: 1,
        message: 'Inscripcion eliminada permanentemente',
        deleted: { enrollment_id: enrollmentId, child_count: children.length, rowCount }
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  // --- Flags / edicion de alumno -----------------------------------------

  async getEnrollmentFlags (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT e.cat_profile_id, e.cat_inscription_modality, e.odoo_user_id, e.odoo_password,
             e.cat_fico_status, e.odoo_email AS stored_odoo_email, e.program_version_id,
             c_fico.alias AS fico_status_alias,
             per.first_name, per.last_name,
             ${STUDENT_EMAIL_SQL} AS origin_email,
             ${STUDENT_PHONE_SQL} AS origin_phone
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cust.person_id
      LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN catalog c_fico ON c_fico.catalog_id = e.cat_fico_status
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    const r = rows?.[0]
    if (r) {
      const { base, domain } = buildOdooEmailBase(r.first_name, r.last_name)
      r.odoo_email = r.stored_odoo_email || (r.odoo_user_id ? `${base}${domain}` : null)
    }
    return r || null
  }

  async getEditStudentCurrent (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT per.first_name, per.last_name, per.document_number, per.person_id,
             ${STUDENT_EMAIL_SQL} AS origin_email,
             ${STUDENT_PHONE_SQL} AS origin_phone,
             l.lead_id,
             e.cat_profile_id, e.odoo_email, e.odoo_user_id, c_prof.description AS profile_desc
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cust.person_id
      LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN catalog c_prof ON c_prof.catalog_id = e.cat_profile_id
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  async updatePerson (personId, fields, values) {
    await this.db.query(`UPDATE persons SET ${fields.join(', ')} WHERE person_id = $${values.length}`, values)
  }

  async updateLeadContact (leadId, fields, values) {
    await this.db.query(`UPDATE leads SET ${fields.join(', ')} WHERE lead_id = $${values.length}`, values)
  }

  async updatePersonContactEmail (personId, originEmail) {
    await this.db.query(
      `UPDATE person_contacts
          SET value = $1
        WHERE person_id = $2
          AND cat_way_contact = (SELECT catalog_id FROM catalog WHERE alias = 'we_way_contact_email' LIMIT 1)
          AND active = 'Y'`,
      [originEmail, personId]
    )
  }

  async updatePersonContactPhone (personId, originPhone) {
    await this.db.query(
      `UPDATE person_contacts
          SET value = $1
        WHERE person_id = $2
          AND cat_way_contact = (SELECT catalog_id FROM catalog WHERE alias = 'we_way_contact_phone' LIMIT 1)
          AND active = 'Y'`,
      [originPhone, personId]
    )
  }

  async updateEnrollmentStudentFields (enrollmentId, fields, values) {
    await this.db.query(`UPDATE enrollments SET ${fields.join(', ')} WHERE enrollment_id = $${values.length}`, values)
  }

  async syncStudentToOdoo (odooUserId, payload) {
    try {
      const res = await odoo.updateStudentInOdoo(odooUserId, payload)
      if (!res.success) console.error('[editStudent] Odoo sync partial:', res.error)
    } catch (e) {
      console.error('[editStudent] Error sincronizando con Odoo:', e.message)
    }
  }

  // --- enrollmentUpdate (edicion de datos de pago/cuotas) -----------------

  async getEnrollmentCurrency (enrollmentId) {
    const { rows } = await this.db.query('SELECT cat_currency FROM enrollments WHERE enrollment_id = $1', [enrollmentId])
    return rows?.[0] || {}
  }

  async getLatestActivePayment (enrollmentId) {
    const { rows } = await this.db.query(
      "SELECT payment_id, cat_method_payment, settled_in_account_id, transaction_code, payment_date FROM payments WHERE enrollment_id = $1 AND active = 'Y' ORDER BY payment_date DESC LIMIT 1",
      [enrollmentId]
    )
    return rows?.[0] || {}
  }

  async updateEnrollmentFields (enrollmentId, sets, params) {
    await this.db.query(`UPDATE enrollments SET ${sets.join(', ')} WHERE enrollment_id = $${params.length}`, params)
  }

  async updatePaymentById (paymentId, sets, params) {
    await this.db.query(`UPDATE payments SET ${sets.join(', ')} WHERE payment_id = $${params.length}`, params)
  }

  async syncLeadPayDate (enrollmentId, newDateIso, userId) {
    try {
      await this.db.query(
        `UPDATE leads SET pay_date = $2::date, user_modification_id = $3
          WHERE enrollment_id = $1`,
        [enrollmentId, newDateIso || null, userId || 9]
      )
    } catch (e) {
      console.error('[enrollmentUpdate] No se pudo sincronizar leads.pay_date:', e.message)
    }
  }

  async updatePendingInstallment ({ amount, dueDate, installmentId, enrollmentId }) {
    await this.db.query(`
      UPDATE payment_installments SET amount = $1, due_date = $2
      WHERE installment_id = $3 AND enrollment_id = $4
    `, [amount, dueDate, installmentId, enrollmentId])
  }

  // Edicion atomica de cuotas pagadas + recalculo de total. Devuelve los deltas
  // de monto aplicados para que el usecase arme las lineas de audit.
  async applyPaidInstallmentEdits ({ enrollmentId, paidInstallments }) {
    const amountDeltas = []
    let totalRecalc = null
    await withTransaction(async client => {
      for (const row of paidInstallments) {
        if (!row.installment_id || !row.before || !row.after) continue
        const { installment_id, installment_number, before, after } = row

        const piSets = []
        const piParams = []
        let piIdx = 1
        if (Number(after.amount) !== Number(before.amount)) {
          piSets.push(`amount = $${piIdx++}`); piParams.push(after.amount)
          amountDeltas.push({ installmentNumber: installment_number, before: Number(before.amount), after: Number(after.amount) })
        }
        const beforeDue = before.due_date ? String(before.due_date).slice(0, 10) : null
        const afterDue = after.due_date ? String(after.due_date).slice(0, 10) : null
        if (afterDue !== beforeDue) {
          piSets.push(`due_date = $${piIdx++}::date`); piParams.push(afterDue)
        }
        if (piSets.length > 0) {
          piParams.push(installment_id, enrollmentId)
          await client.query(
            `UPDATE payment_installments SET ${piSets.join(', ')} WHERE installment_id = $${piIdx++} AND enrollment_id = $${piIdx}`,
            piParams
          )
        }

        let paymentId = row.payment_id || before.payment_id || null
        if (!paymentId) {
          const { rows: pRows } = await client.query(
            "SELECT payment_id FROM payments WHERE installment_id = $1 AND enrollment_id = $2 AND active = 'Y' ORDER BY payment_date DESC LIMIT 1",
            [installment_id, enrollmentId]
          )
          paymentId = pRows?.[0]?.payment_id || null
        }

        if (paymentId) {
          const pSets = []
          const pParams = []
          let pIdx = 1
          if ((after.cat_payment_medium || null) !== (before.cat_payment_medium || null)) {
            pSets.push(`cat_method_payment = $${pIdx++}`); pParams.push(after.cat_payment_medium || null)
          }
          if ((after.bank_account_id || null) !== (before.bank_account_id || null)) {
            pSets.push(`settled_in_account_id = $${pIdx++}`); pParams.push(after.bank_account_id || null)
          }
          if ((after.transaction_code || '') !== (before.transaction_code || '')) {
            pSets.push(`transaction_code = $${pIdx++}`); pParams.push(after.transaction_code || '')
          }
          const beforePay = before.payment_date ? String(before.payment_date).slice(0, 10) : ''
          const afterPay = after.payment_date ? String(after.payment_date).slice(0, 10) : ''
          if (afterPay !== beforePay) {
            pSets.push(`payment_date = $${pIdx++}::date`); pParams.push(afterPay || null)
          }
          if (Number(after.amount) !== Number(before.amount)) {
            pSets.push(`amount = $${pIdx++}`); pParams.push(after.amount)
          }
          if (pSets.length > 0) {
            pParams.push(paymentId)
            await client.query(
              `UPDATE payments SET ${pSets.join(', ')} WHERE payment_id = $${pIdx}`,
              pParams
            )
          }
        }

        if ((after.cat_currency || null) !== (before.cat_currency || null) && after.cat_currency) {
          await client.query('UPDATE enrollments SET cat_currency = $1 WHERE enrollment_id = $2', [after.cat_currency, enrollmentId])
        }
      }

      if (amountDeltas.length > 0) {
        const { rows: sumRows } = await client.query(
          'SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM payment_installments WHERE enrollment_id = $1',
          [enrollmentId]
        )
        const newTotal = Number(sumRows[0]?.total) || 0
        const { rows: eRows } = await client.query(
          'SELECT list_price, discount_amount FROM enrollments WHERE enrollment_id = $1',
          [enrollmentId]
        )
        const oldList = Number(eRows[0]?.list_price) || 0
        const oldDisc = Number(eRows[0]?.discount_amount) || 0
        const newList = newTotal + oldDisc
        await client.query(
          'UPDATE enrollments SET total_amount = $1, list_price = $2 WHERE enrollment_id = $3',
          [newTotal, newList, enrollmentId]
        )
        totalRecalc = { old: `S/. ${oldList - oldDisc}`, new: `S/. ${newTotal}` }
      }
    })
    return { amountDeltas, totalRecalc }
  }

  // Placeholder de pago pre-confirmacion (cat_settlement_status=pending) anclado
  // a la cuota inicial. No cuenta como pagado; lo reemplaza la fila definitiva
  // cuando FICO confirma el pago real.
  async insertPrePaymentPlaceholder ({ enrollmentId, fields, userId }) {
    const { rows: instRows } = await this.db.query(
      `SELECT installment_id, amount FROM payment_installments
        WHERE enrollment_id = $1 AND installment_number = 0
        LIMIT 1`,
      [enrollmentId]
    )
    const inst = instRows?.[0]
    if (!inst) return

    const [typeId, statusId] = await Promise.all([
      getCatalogIdByAlias(ALIAS.PAYMENT_TYPE_INITIAL),
      getCatalogIdByAlias(ALIAS.SETTLEMENT_STATUS_PENDING)
    ])

    await this.db.query(`
      INSERT INTO payments (
        enrollment_id, installment_id, amount, payment_date,
        transaction_code, cat_method_payment, settled_in_account_id,
        cat_payment_type, cat_settlement_status, active,
        user_registration_id, registration_date
      ) VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, 'Y', $10, NOW())
    `, [
      enrollmentId,
      inst.installment_id,
      inst.amount,
      fields.payment_date || null,
      fields.transaction_code || '',
      fields.cat_payment_medium || null,
      fields.bank_account_id || null,
      typeId,
      statusId,
      userId || 9
    ])
  }

  // --- Resolvers de etiqueta para el diff de audit ------------------------

  async resolveLabel (catalogId) {
    if (!catalogId) return null
    const { rows } = await this.db.query('SELECT description FROM catalog WHERE catalog_id = $1', [catalogId])
    return rows?.[0]?.description || String(catalogId)
  }

  async resolveBankLabel (accountId) {
    if (!accountId) return null
    const { rows } = await this.db.query('SELECT bank_name, currency, account_number FROM bank_accounts WHERE account_id = $1', [accountId])
    const r = rows?.[0]
    return r ? `${r.bank_name || ''} ${r.currency || ''} ${r.account_number || ''}`.trim() : String(accountId)
  }

  async resolveBusinessEntityFromAccount (accountId) {
    if (!accountId) return null
    const { rows } = await this.db.query(`
      SELECT c.description
      FROM bank_accounts ba
      LEFT JOIN catalog c ON c.catalog_id = ba.business_entity_catalog_id
      WHERE ba.account_id = $1
    `, [accountId])
    return rows?.[0]?.description || null
  }

  // --- Aprobacion A5 (pending review) ------------------------------------

  // Probe de membresia + resolucion de activacion diferida. SQL movido verbatim
  // desde _resolveMembershipActivation; el caller (usecase) aplica las reglas.
  async probeMembership (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT pv.abbreviation, prog.is_membership
      FROM enrollments e
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN programs prog ON prog.program_id = pv.program_id
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  async resolveActivationWindow (rawDate) {
    const { rows } = await this.db.query(`
      SELECT
        ($1::date <= (NOW() AT TIME ZONE 'America/Lima')::date)                                            AS is_today_or_past,
        ($1::date > ((NOW() AT TIME ZONE 'America/Lima')::date + ($2 || ' months')::interval)::date)      AS out_of_window,
        (($1::date + TIME '09:00:00') AT TIME ZONE 'America/Lima')                                         AS run_at,
        $1::date                                                                                            AS activation_date
    `, [rawDate, String(MEMBERSHIP_ACTIVATION_WINDOW_MONTHS)])
    return rows?.[0] || null
  }

  async approvePendingReviewSp ({ enrollmentId, userId }) {
    const rows = await callProcedureReturningRows(
      pool,
      'public.sp_enrollment_pending_review_approve',
      [JSON.stringify({ enrollment_id: enrollmentId }), userId],
      { statementTimeoutMs: 30000 }
    )
    return rows?.[0] || null
  }

  async persistMembershipActivationDate (enrollmentId, activationDate) {
    try {
      await this.db.query(
        `UPDATE enrollments SET membership_activation_date = $2::date WHERE enrollment_id = $1`,
        [enrollmentId, activationDate]
      )
    } catch (e) {
      console.error('[approvePendingReview] No se pudo persistir membership_activation_date:', e.message)
    }
  }

  async getProgramOdooActivation (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT prog.odoo_activation
        FROM enrollments e
        JOIN program_versions pv ON pv.program_version_id = e.program_version_id
        JOIN programs prog ON prog.program_id = pv.program_id
       WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0]?.odoo_activation || null
  }

  async enqueueMembershipActivation ({ enrollmentId, runAt }) {
    return enqueueJob({
      jobType: 'membership_activation',
      enrollmentId,
      payload: { enrollmentId },
      runAt
    })
  }

  // --- Cola / MV ---------------------------------------------------------

  async getLatestJob (enrollmentId, jobType) {
    return getLatestJobByEnrollment(enrollmentId, jobType || null)
  }

  refreshMv (reason) {
    refreshEnrollmentMv(reason)
  }

  async forceRefreshMv (reason) {
    await forceRefreshEnrollmentMv(reason)
  }

  // --- Efectos cruzados aun en legacy ------------------------------------
  // Disparados EXACTAMENTE como el service legacy (mismos puntos y caracter).

  logAudit (payload) { return _ports.logAudit(payload) }
  enrollInOdoo (payload) { return _ports.enrollInOdoo(payload) }
  sendConfirmationEmail (payload) { return _ports.sendConfirmationEmail(payload) }
  createChildEnrollments (payload) { return _ports.createChildEnrollments(payload) }

  parseEmailCc (raw) { return parseEmailCc(raw) }

  async resolveCatalogId (alias) { return getCatalogIdByAlias(alias) }
}

export const enrollmentRepository = new EnrollmentRepository()
export { ALIAS }
