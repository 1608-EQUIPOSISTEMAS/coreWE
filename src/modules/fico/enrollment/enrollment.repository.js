import { pool, withTransaction } from '../../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../../shared/db/sp.js'
import { attachEventCategory } from '../../../shared/event-category.js'
import { attachChildCourses } from '../../../shared/enrollment-children.js'
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
import { saveLooseInscriptionFields } from '../../../utils/inscription-loose-fields.js'

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

// Una inscripcion en estado terminal ya NO ocupa la edicion: el alumno se fue
// por cambio de curso (CC), reprogramacion (RP), retiro (R) o anulacion. Si
// siguiera contando como duplicado, ese asiento quedaria bloqueado para
// siempre. Paso con el socio que financio su upgrade a WE GOLD con la venta de
// un curso (esa venta quedo en CC) y despues no podia entrar al mismo curso
// usando el beneficio de la membresia.
const STILL_OCCUPIES_EDITION = `
        AND NOT EXISTS (
          SELECT 1
            FROM public."catalog" cst
           WHERE cst.catalog_id = e.cat_type_status
             AND cst.alias IN (
               '${ALIAS.ENROLLMENT_STATUS_COURSE_CHANGED}',
               '${ALIAS.ENROLLMENT_STATUS_REPROGRAMMED}',
               '${ALIAS.ENROLLMENT_STATUS_RETIRED}',
               '${ALIAS.ENROLLMENT_STATUS_ANNULMENT}'
             )
        )`

export class EnrollmentRepository {
  constructor (db = pool) {
    this.db = db
  }

  // --- Listado, KPIs, asesores -------------------------------------------

  async listEnrollments (payload = {}) {
    const rows = await callProcedureReturningRows(
      pool,
      'public.sp_fico_enrollment_list',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 25000 }
    )
    // Ni el SP ni la matview que lee exponen cat_event_category ni el arbol de
    // hijos: se enriquecen aqui para que el listado pueda mostrar la categoria
    // de evento (VIP/GENERAL/...) y los cursos del paquete (CURSO n / FI n).
    await Promise.all([attachEventCategory(rows, pool), attachChildCourses(rows, pool)])
    return rows
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

  // Monedas (SOLES/DOLARES) con su catalog_id. Estan marcadas active='N', por lo
  // que sp_catalog_list NO las incluye en el DTO de catalogos; pero siguen siendo
  // los IDs canonicos referenciados por enrollments. La importacion masiva las lee
  // por aqui para mapear la columna "TIPO DE MONEDA" (PEN/USD) -> cat_currency.
  async currencyList () {
    const { rows } = await this.db.query(
      `SELECT c.catalog_id, c.alias
         FROM public.catalog c
         JOIN public.catalog p ON p.catalog_id = c.catalog_parent_id
        WHERE p.alias = 'we_currency'`
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
             e.membership_program_id,
             mp.program_name AS membership_program_name,
             cts.alias AS cat_type_status_alias,
             e.email_cc,
             e.requires_email_cc,
             e.notes AS advisor_observation,
             -- OS/OP: el panel lo necesita para confirmar la inscripcion sin
             -- pedir datos bancarios (la empresa deposita semanas despues).
             cdt.alias AS b2b_doctype_alias,
             cdt.description AS b2b_doctype_label
      FROM enrollments e
      LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN programs mp ON mp.program_id = e.membership_program_id
      LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
      LEFT JOIN public."catalog" cdt ON cdt.catalog_id = e.cat_b2b_doctype
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  // Descuentos aplicados, para el tooltip del panel. El texto plano del Sheet
  // ("DSTC. PRINCIPAL") no distingue tipos: en los promos de tipo "Monto fijo"
  // el value es el precio FINAL al que queda el curso, no lo descontado, asi que
  // "S/. 150.00 - PROMO FLASH 450" se leia como un descuento de 150 cuando en
  // realidad descuenta 670. Aqui devolvemos value y calculated_amount separados.
  async paymentDetailDiscounts (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT d.description,
             d.value,
             ed.calculated_amount,
             ct.alias       AS discount_type_alias,
             ct.description AS discount_type
        FROM enrollment_discounts ed
        JOIN discounts d ON d.discount_id = ed.discount_id
        LEFT JOIN public."catalog" ct ON ct.catalog_id = d.cat_discount_type
       WHERE ed.enrollment_id = $1
       ORDER BY ed.order_applied
    `, [enrollmentId])
    return rows || []
  }

  // Estado del certificado + pagos adicionales para el panel de detalle (nav
  // Adicionales). Los adicionales son filas de payments sin cuota asociada con
  // tipo we_payment_type_certificate (becados) o we_payment_type_reassignment
  // (proceso de reasignacion de curso jalado).
  async paymentDetailCertificate (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT c.alias AS certificate_status_alias, c.description AS certificate_status_label
        FROM enrollments e
        LEFT JOIN public."catalog" c ON c.catalog_id = e.cat_certificate_status
       WHERE e.enrollment_id = $1
    `, [enrollmentId])
    const status = rows?.[0] || null

    const { rows: pays } = await this.db.query(`
      SELECT p.payment_id, p.amount, p.payment_date, p.transaction_code, p.evidence_url,
             p.cat_method_payment,
             p.settled_in_account_id            AS bank_account_id,
             ba.business_entity_catalog_id      AS cat_business_entity,
             e2.cat_currency,
             cm.description AS payment_method,
             cb.description AS business_entity,
             ba.bank_name, ba.account_number,
             ct.alias AS payment_type_alias
        FROM payments p
        JOIN enrollments e2 ON e2.enrollment_id = p.enrollment_id
        JOIN public."catalog" ct ON ct.catalog_id = p.cat_payment_type
        LEFT JOIN public."catalog" cm ON cm.catalog_id = p.cat_method_payment
        LEFT JOIN bank_accounts ba ON ba.account_id = p.settled_in_account_id
        LEFT JOIN public."catalog" cb ON cb.catalog_id = ba.business_entity_catalog_id
       WHERE p.enrollment_id = $1 AND p.active = 'Y' AND p.installment_id IS NULL
         AND ct.alias IN ('we_payment_type_certificate', 'we_payment_type_reassignment', 'we_payment_type_course_change_diff')
       ORDER BY p.payment_id
    `, [enrollmentId])

    return { status, additionalPayments: pays || [] }
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
        ${STILL_OCCUPIES_EDITION}
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

  // Dedup para convalidaciones (sin edicion): misma persona + mismo curso y
  // program_edition_id NULL. El IS NULL es clave: no choca con una inscripcion
  // normal del mismo curso (esa tiene edicion), solo con otra convalidacion.
  // Hace idempotente re-correr una importacion masiva con filas ED E0.
  async findDuplicateByVersion ({ programVersionId, doc, mail }) {
    const { rows } = await this.db.query(`
      SELECT
        e.enrollment_id,
        e.registration_date,
        e.agent_origin,
        pv.abbreviation                                     AS program_name,
        NULL                                                AS edition_code,
        per.document_number                                 AS existing_document,
        TRIM(BOTH FROM concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS existing_student_name,
        u_s.alias                                           AS seller_agent_alias
      FROM public.enrollments e
      JOIN public.customers       cust ON cust.customer_id = e.customer_id
      JOIN public.persons         per  ON per.person_id    = cust.person_id
      LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN public.leads             l ON l.enrollment_id        = e.enrollment_id
      LEFT JOIN public.users           u_s ON u_s.user_id            = e.seller_agent_id
      WHERE e.active = 'Y'
        AND e.program_version_id = $1
        AND e.program_edition_id IS NULL
        ${STILL_OCCUPIES_EDITION}
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
    `, [programVersionId, doc, mail])
    return rows?.[0] || null
  }

  async registerDirect ({ userId, inscription }) {
    const rows = await callProcedureReturningRows(
      pool,
      'public.sp_fico_enrollment_register_direct',
      [userId, JSON.stringify({ inscription })],
      { statementTimeoutMs: 25000 }
    )
    const res = rows?.[0] || { result: 0, message: 'Sin respuesta del SP' }
    // Campos que el SP no conoce (categoria de entrada del evento). Mismo
    // camino que comercial: un UPDATE aparte que nunca revierte el alta.
    if (res.result === 1 && res.enrollment_id) {
      await saveLooseInscriptionFields(pool, res.enrollment_id, inscription)
    }
    return res
  }

  // Baja el flag que bloquea el envio sin copia. Solo lo llama la observacion
  // de la inscripcion (ver rejectEnrollment): no hay otra via para desactivarlo.
  async clearEmailCcRequirement (enrollmentId) {
    await this.db.query(
      'UPDATE enrollments SET requires_email_cc = false WHERE enrollment_id = $1',
      [enrollmentId]
    )
  }

  async saveEmailCc (enrollmentId, ccArray) {
    await this.db.query(
      'UPDATE enrollments SET email_cc = $1 WHERE enrollment_id = $2',
      [ccArray.join(','), enrollmentId]
    )
  }

  // sapUsername/sapPassword viajan en el payload porque el correo de este flujo
  // lo manda el worker, no el request: sin ellas el alumno de un curso SAP online
  // recibia la confirmacion sin sus accesos al servidor.
  async enqueueRegisterFollowup ({ enrollmentId, userId, sapUsername = null, sapPassword = null }) {
    const job = await enqueueJob({
      jobType: 'register_followup',
      enrollmentId,
      payload: { userId, sapUsername, sapPassword }
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

  async getEditionById (editionId) {
    const { rows } = await this.db.query(`
      SELECT pe.edition_num_id, pe.global_code, pe.start_date, pe.program_version_id
      FROM program_editions pe
      WHERE pe.edition_num_id = $1
    `, [editionId])
    return rows?.[0] || null
  }

  // Todas las ediciones activas con su par (version_code, global_code) en UNA
  // query. La importacion masiva la indexa en un Map y resuelve la columna ED
  // por fila en memoria (antes era 1 query por fila -> timeout en hojas grandes).
  async listActiveEditions () {
    const { rows } = await this.db.query(`
      SELECT pe.edition_num_id AS program_edition_id, pe.program_version_id,
             pe.global_code, pv.version_code,
             -- es paquete (deberia tener aulas hijas): diplomado/especializacion/PEE.
             -- Lo usa el importador para AVISAR si el paquete no tiene estructura.
             (ct.alias IN ('we_program_type_diploma','we_program_type_specialization','we_program_type_pee')) AS is_package
      FROM program_editions pe
      JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
      JOIN public.programs pr ON pr.program_id = pv.program_id
 LEFT JOIN public."catalog" ct ON ct.catalog_id = pr.cat_type_program
      WHERE pe.active = 'Y'
    `)
    return rows
  }

  // Estructura padre->hijos a nivel de edicion/aula. Una edicion-padre (paquete/
  // especializacion) tiene N aulas hijas. La importacion crea las inscripciones
  // hijas en estas aulas cuando el alumno compra el padre.
  async listEditionStructure () {
    const { rows } = await this.db.query(`
      SELECT es.parent_edition_id, es.child_edition_id,
             pe.program_version_id AS child_version_id
      FROM public.edition_structure es
      JOIN public.program_editions pe ON pe.edition_num_id = es.child_edition_id
      WHERE pe.active = 'Y'
    `)
    return rows
  }

  // Usuarios-asesor con su alias (codigo de agente, ej "AE30"). La importacion
  // masiva lo indexa para resolver la columna AS -> seller_agent_id.
  async listAgents () {
    const { rows } = await this.db.query(
      `SELECT user_id, alias FROM public.users WHERE alias IS NOT NULL AND alias <> ''`)
    return rows
  }

  // Setea/actualiza el agente de una inscripcion. COALESCE: no borra lo existente
  // si el valor entrante es null. Usado por la importacion al re-encontrar una
  // inscripcion duplicada para completarle el asesor.
  async updateEnrollmentAgent (enrollmentId, sellerAgentId, agentOrigin) {
    await this.db.query(
      `UPDATE public.enrollments
          SET seller_agent_id = COALESCE($2, seller_agent_id),
              agent_origin    = COALESCE($3, agent_origin)
        WHERE enrollment_id = $1`,
      [enrollmentId, sellerAgentId ?? null, agentOrigin ?? null])
  }

  // Versiones de los programas-membresia (WE BLACK/GOLD/PLAT/PLUS) con su
  // abreviatura. La importacion masiva la usa para, ante una fila con columna J
  // (tier), crear la inscripcion de membresia que marca a la persona como miembro.
  async listMembershipVersions () {
    const { rows } = await this.db.query(`
      SELECT pv.program_version_id, pv.program_id, pv.abbreviation
      FROM program_versions pv
      JOIN programs p ON p.program_id = pv.program_id
      WHERE p.is_membership = true AND pv.active = 'Y'
    `)
    return rows
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

  // Cuotas pendientes reales del origen: excluye pagadas (ambos namespaces:
  // legacy 4454 y nuevo 2471), anuladas (4456) y las que ya tienen un pago
  // activo aunque su estado siga "pendiente verificacion/conciliacion" (2470):
  // ese dinero ya entro y debe quedarse en el origen RP. Solo lo realmente
  // adeudado se traslada al enrollment destino.
  async getReprogramPendingInstallments (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT pi.installment_id, pi.installment_number, pi.amount, pi.due_date
      FROM payment_installments pi
      WHERE pi.enrollment_id = $1 AND pi.installment_number > 0
        AND pi.cat_status NOT IN (4454, 2471, 4456)
        AND NOT EXISTS (
          SELECT 1 FROM payments p
          WHERE p.installment_id = pi.installment_id AND p.active = 'Y'
        )
      ORDER BY pi.installment_number
    `, [enrollmentId])
    return rows
  }

  // Bloque atomico del traslado de cuotas en una RP: elimina la cuota "pago
  // cero" que el SP creo en el destino (recien nacido: es su unica fila) y
  // mueve las pendientes del origen con su nuevo numero/monto/fecha. Sin
  // pendientes, solo re-etiqueta la cuota cero para que no diga "Beca".
  async transferInstallmentsForReprogram ({ oldEnrollmentId, newEid, plan }) {
    await withTransaction(async client => {
      if (plan.length === 0) {
        await client.query(
          'UPDATE payment_installments SET notes = $2 WHERE enrollment_id = $1',
          [newEid, `Reprogramacion - pagos registrados en inscripcion #${oldEnrollmentId}`]
        )
        return
      }
      await client.query('DELETE FROM payment_installments WHERE enrollment_id = $1', [newEid])
      for (const p of plan) {
        const res = await client.query(`
          UPDATE payment_installments
          SET enrollment_id = $1, installment_number = $2, amount = $3, due_date = $4, notes = $5
          WHERE installment_id = $6 AND enrollment_id = $7
        `, [
          newEid, p.number, p.amount, p.due_date,
          `Cuota ${p.number} - Pendiente (trasladada por reprogramacion de #${oldEnrollmentId})`,
          p.installment_id, oldEnrollmentId
        ])
        if (res.rowCount !== 1) {
          throw new Error(`Cuota ${p.installment_id} ya no esta pendiente en el origen (posible cambio concurrente)`)
        }
      }
    })
  }

  // --- Cambio de curso ----------------------------------------------------

  async getCourseChangeOrigin (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id, e.program_version_id, e.program_edition_id,
             e.customer_id, e.seller_agent_id, e.agent_origin, e.email_cc,
             e.parent_enrollment_id,
             e.total_amount, e.discount_amount, e.cat_currency,
             e.cat_inscription_modality, e.cat_payment_channel, e.cat_payment_plan,
             per.first_name, per.last_name, per.document_number, per.cat_type_document,
             l.lead_id,
             ${STUDENT_EMAIL_SQL} AS origin_email,
             ${STUDENT_PHONE_SQL} AS origin_phone,
             l.cat_code_country,
             pv.abbreviation AS old_program_name,
             prog.odoo_activation AS old_odoo_activation,
             pe.global_code AS old_edition_code, pe.start_date AS old_start_date,
             c_prof.alias AS old_profile_alias
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cust.person_id
      LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN programs prog ON prog.program_id = pv.program_id
      LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      LEFT JOIN public."catalog" c_prof ON c_prof.catalog_id = e.cat_profile_id
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

  // Destino sin edicion: las membresias no tienen program_editions, asi que el CC
  // resuelve el programa directamente. Devuelve la misma forma que
  // getCourseChangeDestEdition (global_code/start_date null) para que el usecase
  // arme la auditoria sin ramas adicionales.
  async getCourseChangeDestProgram (newProgramVersionId) {
    const { rows } = await this.db.query(`
      SELECT NULL::int AS edition_num_id, NULL::text AS global_code, NULL::date AS start_date,
             pv.abbreviation AS new_program_name, pv.program_version_id,
             COALESCE(prog.is_membership, false) AS is_membership,
             EXISTS (
               SELECT 1 FROM program_editions pe
               WHERE pe.program_version_id = pv.program_version_id
                 AND pe.active = 'Y' AND pe.start_date >= CURRENT_DATE
             ) AS has_editions
      FROM program_versions pv
      JOIN programs prog ON prog.program_id = pv.program_id
      WHERE pv.program_version_id = $1
    `, [newProgramVersionId])
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
      SELECT e.cat_inscription_modality,
             c_old.description AS old_modality,
             (SELECT COUNT(*) FROM enrollments h WHERE h.parent_enrollment_id = e.enrollment_id)::int
               AS children_count,
             (SELECT COUNT(*) FROM enrollments h WHERE h.parent_enrollment_id = e.enrollment_id
                AND h.cat_inscription_modality = e.cat_inscription_modality)::int
               AS children_in_modality
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

  // La modalidad es del paquete, no de cada curso: los hijos (SEG) viajan con
  // el padre. Sin esto el aula seguia listando los cursos con la modalidad
  // vieja y no salian como FLEX (edition.repository lee e.cat_inscription_modality
  // fila por fila, no la del padre). Devuelve cuantas filas se movieron.
  async setModalityWithChildren (enrollmentId, newModalityId) {
    const { rowCount } = await this.db.query(`
      UPDATE enrollments
         SET cat_inscription_modality = $1
       WHERE enrollment_id = $2
          OR parent_enrollment_id = $2
    `, [newModalityId, enrollmentId])
    return rowCount
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
             pe2.start_date,
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
             ${STUDENT_PHONE_SQL} AS origin_phone,
             -- Subsanacion: el asesor reabre el modal en blanco, asi que necesita
             -- recuperar el canal con el que nacio la venta. Sin esto una venta
             -- por link/token se le resetea a General y le pide un voucher que no
             -- existe (pago por pasarela).
             c_chan.alias AS payment_channel_alias,
             -- El proveedor del link lo elige FICO al pegarlo, no el asesor: su
             -- modal no dibuja ese campo. Viaja oculto en el payload para que la
             -- guarda de canal token no lo deje encerrado.
             tok.cat_provider AS token_provider_id,
             tok.payment_type AS token_payment_type,
             -- Curso SAP online: el reenvio rapido pide credenciales a mano.
             (prog.cat_category = cat_sap.catalog_id
              AND prog.cat_model_modality = mod_online.catalog_id) AS is_sap_online
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cust.person_id
      LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN catalog c_fico ON c_fico.catalog_id = e.cat_fico_status
      LEFT JOIN catalog c_chan ON c_chan.catalog_id = e.cat_payment_channel
      LEFT JOIN LATERAL (
        SELECT pt.cat_provider, pt.payment_type
        FROM payment_tokens pt
        WHERE pt.enrollment_id = e.enrollment_id
        ORDER BY pt.token_id DESC
        LIMIT 1
      ) tok ON true
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN programs prog ON prog.program_id = pv.program_id
      LEFT JOIN catalog cat_sap ON cat_sap.alias = 'we_program_category_sap'
      LEFT JOIN catalog mod_online ON mod_online.alias = 'we_modality_online'
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
      SELECT per.first_name, per.last_name, per.mother_last_name, per.document_number, per.person_id,
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

  // Pago "principal" que edita el formulario de Pago Inicial / contado: el de la
  // cuota inicial (installment_number = 0). NO se debe identificar por la fecha
  // mas reciente: si una cuota pagada recibe una fecha posterior, ese pago pasaria
  // a ser "el ultimo" y la edicion del pago inicial lo sobrescribiria por error
  // (bug: la fecha de una cuota pagada se revertia al guardar). Fallback al ultimo
  // pago activo solo si no existe cuota inicial con pago.
  async getInitialPayment (enrollmentId) {
    const { rows } = await this.db.query(
      `SELECT p.payment_id, p.cat_method_payment, p.settled_in_account_id, p.transaction_code, p.payment_date
         FROM payments p
         JOIN payment_installments pi ON pi.installment_id = p.installment_id
        WHERE p.enrollment_id = $1 AND p.active = 'Y' AND pi.installment_number = 0
        ORDER BY p.payment_date DESC, p.payment_id DESC
        LIMIT 1`,
      [enrollmentId]
    )
    if (rows?.[0]) return rows[0]
    const { rows: fb } = await this.db.query(
      "SELECT payment_id, cat_method_payment, settled_in_account_id, transaction_code, payment_date FROM payments WHERE enrollment_id = $1 AND active = 'Y' ORDER BY payment_date DESC LIMIT 1",
      [enrollmentId]
    )
    return fb?.[0] || {}
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

  // Realinea la cabecera del enrollment con lo que dicen sus cuotas. Editar el
  // monto de una cuota cambia el precio real de la venta, pero total_amount
  // seguia con el valor que trajo FICO al registrarla: la ficha mostraba el
  // total nuevo (suma de cuotas) y el saldo viejo (total_amount - pagado), y el
  // listado mostraba el total viejo. Le paso a la inscripcion 16394: cuotas
  // 80 + 248 = 328 contra un total_amount de 410.
  //
  // El precio de lista NO se toca: es del programa, no de la venta. Lo que
  // absorbe la diferencia es el descuento, igual que en applyCampaignTx.
  // Devuelve null si no hubo cambio, para no ensuciar la bitacora.
  async recalcTotalsFromInstallments (enrollmentId) {
    const { rows } = await this.db.query(`
      WITH cuotas AS (
        SELECT COALESCE(SUM(amount), 0)::numeric AS total
          FROM payment_installments WHERE enrollment_id = $1
      ), antes AS (
        SELECT total_amount FROM enrollments WHERE enrollment_id = $1
      )
      UPDATE enrollments e
         SET total_amount    = cuotas.total,
             discount_amount = GREATEST(0, COALESCE(e.list_price, 0) - cuotas.total)
        FROM cuotas, antes
       WHERE e.enrollment_id = $1
         AND antes.total_amount IS DISTINCT FROM cuotas.total
      RETURNING antes.total_amount AS anterior, e.total_amount AS nuevo
    `, [enrollmentId])
    if (!rows[0]) return null
    return { old: Number(rows[0].anterior), new: Number(rows[0].nuevo) }
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
    // Cuota inicial = numero 0 (plan en cuotas). El contado no tiene cuota 0:
    // el SP register_direct crea UNA sola cuota numero 1, asi que si no hay 0
    // y la inscripcion tiene una unica cuota, el pago inicial cuelga de esa.
    // Antes este metodo retornaba sin hacer nada en ese caso y la edicion de
    // pago de un contado sin payment previo (tipico de importaciones) se
    // perdia en silencio aunque el historial la registraba.
    const { rows: instRows } = await this.db.query(
      `SELECT installment_id, installment_number, amount FROM payment_installments
        WHERE enrollment_id = $1
        ORDER BY installment_number ASC
        LIMIT 2`,
      [enrollmentId]
    )
    const inst = instRows?.[0]
    const isInitial = inst && (Number(inst.installment_number) === 0 || instRows.length === 1)
    if (!isInitial) return

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
