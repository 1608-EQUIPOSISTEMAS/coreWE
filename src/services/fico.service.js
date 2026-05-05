import { pool } from '../config/db.js'
import { callProcedureReturningRows } from '../utils/spHelper.js'
import { ALIAS } from '../utils/catalog-aliases.js'
import { getCatalogIdByAlias } from '../utils/catalog-helper.js'
import { safeAsync } from '../utils/safe-async.js'
import odooClient from '../config/odooClient.js'
import { sendEmail, sendFicoEmail } from '../config/zeptomail.js'
import { buildConfirmacionHTML } from '../templates/confirmacion-inscripcion.js'
import { buildConfirmacionOnlineHTML } from '../templates/confirmacion-online.js'
import { buildConfirmacionPagoHTML } from '../templates/confirmacion-pago.js'
import { buildMembresiaHTML, detectMembershipType } from '../templates/bienvenida-membresia.js'
import { generateCronogramaPdf } from './pdf.service.js'
import slackClient from '../config/slack.js'

// =============================================================================
// MEMBRESIA: helpers de fechas
// =============================================================================
// La membresia siempre es de 12 meses (regla de negocio actual). Si el dia de
// manana se hace configurable por programa, este es el unico punto a tocar.
const MEMBERSHIP_DURATION_MONTHS = 12

// Formato dd/mm/yyyy usando getters UTC. Postgres parsea columnas DATE como
// UTC-medianoche en JS; usar getDate()/toLocaleDateString aplicaria la TZ del
// proceso Node y restaria 1 dia en prod (UTC) frente a local (Lima). UTC
// getters leen los componentes "tal cual los puso pg".
function formatCalendarDate (raw) {
  if (!raw) return '---'
  const d = raw instanceof Date ? raw : new Date(raw)
  if (isNaN(d)) return '---'
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getUTCFullYear()}`
}

// Suma meses preservando "ultimo dia del mes" cuando el destino es mas corto
// (31 ene + 1 mes = 28/29 feb, no 3 mar). setUTCMonth puro causa overflow al
// mes siguiente, asi que detectamos el cambio de dia y rebobinamos a fin de mes.
function addMonthsCalendar (raw, months) {
  if (!raw) return null
  const base = raw instanceof Date ? new Date(raw.getTime()) : new Date(raw)
  if (isNaN(base)) return null
  const originalDay = base.getUTCDate()
  base.setUTCMonth(base.getUTCMonth() + months)
  if (base.getUTCDate() !== originalDay) base.setUTCDate(0)
  return base
}

// =============================================================================
// SQL FRAGMENTS REUSABLES
// =============================================================================
// Source of Truth para resolver datos de contacto del alumno.
// Las inscripciones FICO directas no crean lead, por lo que `leads.origin_email`
// es NULL — el correo y telefono viven solo en `person_contacts`.
// Cualquier query que necesite estos datos DEBE usar estos fragmentos.

// Resuelve email del alumno: lead.origin_email -> person_contacts (way_email)
// Requiere alias `l` (leads) y `per` (persons) en la query base.
const STUDENT_EMAIL_SQL = `
  COALESCE(
    l.origin_email,
    (SELECT pc.value FROM person_contacts pc
       WHERE pc.person_id = per.person_id
         AND pc.cat_way_contact = (SELECT catalog_id FROM catalog WHERE alias = 'we_way_contact_email' LIMIT 1)
         AND pc.active = 'Y'
       ORDER BY pc.registration_date DESC LIMIT 1)
  )`

// Resuelve telefono del alumno: lead.origin_phone -> person_contacts (way_phone)
const STUDENT_PHONE_SQL = `
  COALESCE(
    l.origin_phone,
    (SELECT pc.value FROM person_contacts pc
       WHERE pc.person_id = per.person_id
         AND pc.cat_way_contact = (SELECT catalog_id FROM catalog WHERE alias = 'we_way_contact_phone' LIMIT 1)
         AND pc.active = 'Y'
       ORDER BY pc.registration_date DESC LIMIT 1)
  )`

// Parsea un string de CCs a array de emails validos. Acepta separadores `,` y `;`.
// Solo emails con formato basico pasan; los invalidos se descartan silenciosamente
// (el frontend ya valida antes de enviar; este parser es defensa en profundidad).
function parseEmailCc (raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(Boolean).map(e => String(e).trim()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
  return String(raw)
    .split(/[,;]/)
    .map(e => e.trim())
    .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
}

async function enrollmentList (payload = {}) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_fico_enrollment_list',
    [JSON.stringify(payload)],
    { statementTimeoutMs: 25000 }
  )

  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0

  return {
    total,
    page: Number(payload.page || 1),
    size: Number(payload.size || 25),
    items: rows
  }
}


async function paymentDetailGet ({ enrollment_id }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_fico_payment_detail_get',
    [enrollment_id],
    { statementTimeoutMs: 25000 }
  )

  const result = rows?.[0] || null
  if (result) {
    try {
      const { rows: edRows } = await pool.query(`
        SELECT pe.start_date AS edition_start_date, pe.end_date AS edition_end_date,
               l.pay_date AS commercial_pay_date
        FROM enrollments e
        LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
        LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
        WHERE e.enrollment_id = $1
      `, [enrollment_id])
      if (edRows?.[0]) {
        result.edition_start_date    = edRows[0].edition_start_date || null
        result.edition_end_date      = edRows[0].edition_end_date || null
        result.commercial_pay_date   = edRows[0].commercial_pay_date || null
      }
    } catch (err) {
      console.error('[paymentDetailGet] edition dates:', err.message)
    }
  }
  return result
}


async function confirmPayment (payload) {
  // Validacion previa: si la inscripcion es padre con hijos, todos los hijos no convalidados
  // deben tener una edicion asignable (en el arbol del padre o custom). Si falta, abortar.
  if (payload.enrollment_id) {
    try {
      const validation = await validateChildEnrollmentSetup({ enrollmentId: payload.enrollment_id })
      if (!validation.ok) {
        return {
          result: 2,
          message: 'Faltan ediciones por configurar antes de confirmar el pago',
          validation_errors: validation.errors
        }
      }
    } catch (vErr) {
      console.error('[confirmPayment] validateChildEnrollmentSetup falló:', vErr.message, vErr.stack)
      // No abortamos: los enrollments sin estructura de hijos no requieren validacion.
    }
  }

  // Capturamos el max payment_id ANTES del SP. Cualquier payment activo con id <= a este
  // valor es un placeholder previo creado por sp_comercial_enrollment_register cuando el
  // token fue confirmado (cat_payment_type=3113, sin transaction_code, payment_date defaulteado
  // a CURRENT_TIMESTAMP). Cuando FICO confirma el pago real, ese placeholder queda obsoleto:
  // su payment_date desplaza visualmente el pago real en payment_history (ordenado DESC) y
  // su monto distorsiona el calculo de PAGADO. Lo desactivamos despues que el SP grabe el real.
  let prevMaxPayId = 0
  if (payload.enrollment_id) {
    try {
      const { rows: prev } = await pool.query(
        "SELECT COALESCE(MAX(payment_id), 0) AS max_id FROM payments WHERE enrollment_id = $1 AND active = 'Y'",
        [payload.enrollment_id]
      )
      prevMaxPayId = Number(prev?.[0]?.max_id) || 0
    } catch (e) {
      console.error('[confirmPayment] No se pudo capturar prevMaxPayId:', e.message)
    }
  }

  let resp
  try {
    const { rows } = await pool.query(
      'SELECT * FROM public.sp_fico_confirm_payment($1::jsonb)',
      [JSON.stringify(payload)]
    )
    resp = rows?.[0] || { result: 0, message: 'Sin respuesta' }
  } catch (spErr) {
    console.error('[confirmPayment] SP sp_fico_confirm_payment falló:', spErr.message, spErr.stack, 'payload:', JSON.stringify(payload))
    throw new Error(`SP confirm_payment: ${spErr.message}`)
  }

  if (resp.result === 1 && payload.enrollment_id) {
    if (prevMaxPayId > 0) {
      try {
        await pool.query(
          `UPDATE payments
              SET active = 'N'
            WHERE enrollment_id = $1
              AND payment_id <= $2
              AND active = 'Y'
              AND cat_payment_type = 3113
              AND COALESCE(NULLIF(TRIM(transaction_code), ''), NULL) IS NULL`,
          [payload.enrollment_id, prevMaxPayId]
        )
      } catch (e) {
        console.error('[confirmPayment] No se pudo desactivar placeholder:', e.message)
      }
    }

    // Sincronizamos leads.pay_date con la fecha real que FICO acaba de registrar.
    // sp_fico_enrollment_list usa cascada leads.pay_date -> payments.payment_date -> registration_date
    // y leads.pay_date gana. Si comercial no la sabia al crear el token, quedo en CURRENT_DATE
    // y el listado mostraba hoy aunque el pago real sea otro dia. Aqui la corregimos al hecho.
    if (payload.payment_date) {
      try {
        await pool.query(
          `UPDATE leads SET pay_date = $2::date, user_modification_id = $3
            WHERE enrollment_id = $1`,
          [payload.enrollment_id, payload.payment_date, payload.user_id || 9]
        )
      } catch (e) {
        console.error('[confirmPayment] No se pudo sincronizar leads.pay_date:', e.message)
      }
    }

    try {
      await logAudit({
        enrollmentId: payload.enrollment_id,
        action: 'approved',
        userId: payload.user_id,
        details: `Pago confirmado: ${payload.action || ''}`
      })
    } catch (auditErr) {
      console.error('[confirmPayment] logAudit approved falló:', auditErr.message)
    }

    try {
      await createChildEnrollments({ enrollmentId: payload.enrollment_id, userId: payload.user_id })
    } catch (err) {
      console.error('[confirmPayment] Error creando enrollments hijos:', err.message)
    }

    try {
      await pool.query(
        "UPDATE payment_tokens SET status = 'confirmed', confirmed_by = $1, updated_at = NOW() WHERE enrollment_id = $2 AND status != 'confirmed'",
        [payload.user_id, payload.enrollment_id]
      )
    } catch (err) {
      console.error('[confirmPayment] Error actualizando token:', err.message)
    }

    try {
      const { rows: enrollOdoo } = await pool.query(
        'SELECT odoo_order_id FROM enrollments WHERE enrollment_id = $1',
        [payload.enrollment_id]
      )
      let odooOrderId = enrollOdoo?.[0]?.odoo_order_id

      if (!odooOrderId) {
        const odooResult = await enrollInOdoo({ enrollmentId: payload.enrollment_id })
        if (odooResult?.success) {
          const cursoLabel = odooResult.course_search || 'Curso no especificado'
          await logAudit({
            enrollmentId: payload.enrollment_id,
            action: 'odoo_enrolled',
            userId: payload.user_id,
            details: `Odoo user ${odooResult.odoo_user_id} - ${cursoLabel}`
          })
          const { rows: updated } = await pool.query(
            'SELECT odoo_order_id FROM enrollments WHERE enrollment_id = $1',
            [payload.enrollment_id]
          )
          odooOrderId = updated?.[0]?.odoo_order_id
        }
      }

      if (odooOrderId) {
        const activated = await odooClient.activateFees(odooOrderId)
        if (activated?.activated > 0) {
          await logAudit({
            enrollmentId: payload.enrollment_id,
            action: 'odoo_fees_activated',
            userId: payload.user_id,
            details: `${activated.activated} cuota(s) pasadas a Pendiente en Odoo`
          })
        }
      }
    } catch (odooErr) {
      console.error('[confirmPayment] Odoo enroll/activate:', odooErr.message)
    }

    if (payload.action === 'confirm_contado') {
      try {
        const odooResult = await syncInstallmentPaymentToOdoo({
          enrollmentId: payload.enrollment_id,
          installmentNumber: 1
        })
        if (odooResult?.success) {
          await logAudit({
            enrollmentId: payload.enrollment_id,
            action: 'odoo_fee_paid',
            userId: payload.user_id,
            details: `Pago contado sincronizado con Odoo (fee_id: ${odooResult.fee_id})`
          })
        }
      } catch (odooErr) {
        console.error('[confirmPayment] Odoo sync contado:', odooErr.message)
      }
    }
  }

  return resp
}

/**
 * Carga la estructura completa de hijos para un enrollment padre.
 * Devuelve los datos necesarios para planear ediciones y validar.
 *
 * @returns {Promise<{
 *   parent: object,
 *   childrenStruct: Array<{child_program_version_id: number, child_name: string, sort_order: number}>,
 *   editionMap: Object<number, {editionId, globalCode, startDate, sortOrder}>,
 *   validations: Array,
 *   validatedSet: Set<number>,
 *   customEditions: Object<number, number>
 * }|null>}
 */
async function _loadChildrenContext (enrollmentId) {
  const { rows: parentRows } = await pool.query(
    'SELECT enrollment_id, program_version_id, program_edition_id FROM enrollments WHERE enrollment_id = $1',
    [enrollmentId]
  )
  const parent = parentRows?.[0]
  if (!parent) return null

  const { rows: structRows } = await pool.query(`
    SELECT pvs.child_program_version_id, pvs.sort_order, pv.abbreviation AS child_name
      FROM program_version_structure pvs
      JOIN program_versions pv ON pv.program_version_id = pvs.child_program_version_id
     WHERE pvs.parent_program_version_id = $1
     ORDER BY pvs.sort_order
  `, [parent.program_version_id])

  const childrenStruct = structRows || []
  if (childrenStruct.length === 0) return { parent, childrenStruct: [], editionMap: {}, validations: [], validatedSet: new Set(), customEditions: {} }

  const treeRows = parent.program_edition_id
    ? await callProcedureReturningRows(pool, 'public.sp_edition_tree_get', [parent.program_edition_id], { statementTimeoutMs: 15000 }).catch(() => [])
    : []
  const treeChildren = treeRows?.[0]?.children || []

  const editionMap = {}
  for (const ch of treeChildren) {
    if (ch.child_program_version_id && (ch.edition_id || ch.edition_num_id)) {
      editionMap[ch.child_program_version_id] = {
        editionId: ch.edition_id || ch.edition_num_id,
        globalCode: ch.global_code || '',
        startDate: ch.start_date || '',
        sortOrder: ch.sort_order || 0
      }
    }
  }

  const validations = await getValidations({ enrollmentId })
  const validatedSet = new Set(
    validations.filter(v => v.validation_type !== 'edition_override').map(v => v.child_version_id)
  )
  const customEditions = {}
  validations.filter(v => v.custom_edition_id).forEach(v => { customEditions[v.child_version_id] = v.custom_edition_id })

  return { parent, childrenStruct, editionMap, validations, validatedSet, customEditions }
}

/**
 * Valida que el setup de hijos sea inscribible.
 * Si algun hijo NO esta convalidado Y NO esta en el arbol del padre Y NO tiene custom_edition_id,
 * devuelve error indicando que el operador debe convalidar o elegir edicion.
 */
async function validateChildEnrollmentSetup ({ enrollmentId }) {
  const ctx = await _loadChildrenContext(enrollmentId)
  if (!ctx) return { ok: true, errors: [] }
  if (ctx.childrenStruct.length === 0) return { ok: true, errors: [] }

  const errors = []
  for (const ch of ctx.childrenStruct) {
    const childPvId = ch.child_program_version_id
    if (ctx.validatedSet.has(childPvId)) continue
    const inTree = !!ctx.editionMap[childPvId]
    const hasCustom = !!ctx.customEditions[childPvId]
    if (!inTree && !hasCustom) {
      errors.push({
        child_program_version_id: childPvId,
        child_name: ch.child_name,
        message: `El modulo "${ch.child_name}" no tiene edicion programada en este diplomado. Debes convalidarlo o elegir una edicion especifica.`
      })
    }
  }
  return { ok: errors.length === 0, errors }
}

async function createChildEnrollments ({ enrollmentId, userId }) {
  const ctx = await _loadChildrenContext(enrollmentId)
  if (!ctx || ctx.childrenStruct.length === 0) {
    console.log('[childEnrollments] Sin hijos para procesar, saliendo')
    return { isE0: false, createdChildren: [] }
  }

  // Datos completos del padre para INSERTs de hijos
  const { rows: parentData } = await pool.query(`
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
  const parent = parentData?.[0]
  if (!parent) return { isE0: false, createdChildren: [] }

  // Plan de inscripcion: para cada hijo NO convalidado, definir su edicion final.
  // Detectar si algun hijo esta fuera del arbol del padre = escenario E0.
  const editionPlan = []
  let anyOutsideTree = false
  for (const ch of ctx.childrenStruct) {
    const childPvId = ch.child_program_version_id
    if (ctx.validatedSet.has(childPvId)) continue
    const treeEdition = ctx.editionMap[childPvId]
    const customEdId = ctx.customEditions[childPvId]
    const isOutsideTree = !treeEdition
    if (isOutsideTree) anyOutsideTree = true
    const editionId = customEdId || treeEdition?.editionId
    if (!editionId) {
      // Sin edicion asignable. Se loguea y se salta este hijo.
      await logAudit({
        enrollmentId,
        action: 'children_skipped_no_edition',
        userId,
        details: `Modulo ${ch.child_name} (pv=${childPvId}) saltado: sin edicion en arbol del padre y sin custom edition`
      })
      continue
    }
    editionPlan.push({
      childPvId,
      childName: ch.child_name,
      editionId,
      isOutsideTree,
      globalCode: treeEdition?.globalCode || `(custom-${editionId})`,
      sortOrder: ch.sort_order ?? treeEdition?.sortOrder ?? 0
    })
  }

  if (editionPlan.length === 0) {
    console.log('[childEnrollments] No hay hijos a inscribir (todos convalidados o sin edicion)')
    return { isE0: false, createdChildren: [] }
  }

  const isE0 = anyOutsideTree

  // Si E0: marcar el enrollment padre con program_edition_id = NULL
  // para que enrollInOdoo lo trate como "no inscribir el padre" y los hijos vayan individualmente.
  if (isE0) {
    await pool.query(
      'UPDATE enrollments SET program_edition_id = NULL WHERE enrollment_id = $1',
      [enrollmentId]
    )
    await logAudit({
      enrollmentId,
      action: 'parent_marked_e0',
      userId,
      details: `Diplomado marcado como E0: ${editionPlan.length} modulo(s) inscritos individualmente, fuera del arbol del padre`
    })
  }

  const certCatId    = await getCatalogIdByAlias(ALIAS.CERTIFICATE_STATUS_PAID)
  const contadoCatId = await getCatalogIdByAlias(ALIAS.PAYMENT_WAY_SINGLE)
  const segCatId     = await getCatalogIdByAlias(ALIAS.ENROLLMENT_STATUS_TRACKING)
  const checkedCatId = await getCatalogIdByAlias(ALIAS.ENROLLMENT_STATUS_CHECKED)

  const { rows: parentAttachments } = await pool.query(
    `SELECT file_url AS url, file_url AS name FROM enrollment_attachments WHERE enrollment_id = $1 AND active = 'Y'`,
    [enrollmentId]
  ).catch(() => ({ rows: [] }))

  const createdChildren = []
  const totalChildren = editionPlan.length

  for (const item of editionPlan) {
    const childPvId = item.childPvId
    const editionId = item.editionId

    try {
      const { rows: newEnroll } = await pool.query(`
        INSERT INTO enrollments (
          customer_id, program_version_id, program_edition_id,
          parent_enrollment_id, total_amount, discount_amount, list_price,
          cat_currency, cat_inscription_modality, cat_payment_channel, cat_payment_plan,
          cat_fico_status, cat_type_status, cat_certificate_status, cat_profile_id,
          seller_agent_id, active, user_registration_id, registration_date,
          notes
        ) VALUES (
          $1, $2, $3,
          $4, 0, 0, 0,
          $5, $6, $7, $8,
          $9, $10, $11, $15,
          $12, 'Y', $13, NOW(),
          $14
        ) RETURNING enrollment_id
      `, [
        parent.customer_id, childPvId, editionId,
        enrollmentId,
        parent.cat_currency, parent.cat_inscription_modality, parent.cat_payment_channel, contadoCatId || parent.cat_payment_plan,
        checkedCatId || null, segCatId || null, certCatId || null,
        parent.seller_agent_id, userId || 9,
        `Seguimiento (${item.sortOrder}/${totalChildren}) de ${parent.parent_program_name || ''} ${parent.parent_edition_code || ''}`.trim(),
        parent.cat_profile_id
      ])

      const childEid = newEnroll?.[0]?.enrollment_id
      if (childEid) {
        await logAudit({
          enrollmentId: childEid,
          action: 'created',
          userId,
          details: `Seguimiento ${item.globalCode} (${item.sortOrder}/${totalChildren}) - Modulo de ${parent.parent_program_name || ''}${item.isOutsideTree ? ' (E0: edicion individual)' : ''}`
        })
        createdChildren.push({ id: childEid, code: item.globalCode, order: item.sortOrder, isOutsideTree: item.isOutsideTree })

        // Si es E0, sincronizar el hijo individualmente con Odoo + email.
        // En el flujo normal (no E0), el padre cubre los hijos en su slide_group.
        if (isE0) {
          const odooRes = await safeAsync(`[childEnrollments][Odoo] enroll child #${childEid}`, () => enrollInOdoo({ enrollmentId: childEid }))
          if (odooRes?.success) {
            await logAudit({ enrollmentId: childEid, action: 'odoo_enrolled', userId, details: `Inscripcion individual E0 en Odoo: user ${odooRes.odoo_user_id}` })
          }
          const emailRes = await safeAsync(`[childEnrollments][Email] send child #${childEid}`, () => sendConfirmationEmail({ enrollmentId: childEid }))
          if (emailRes?.success) {
            await logAudit({ enrollmentId: childEid, action: 'email_sent', userId, details: `Correo confirmacion enviado (E0)` })
          }
        }
      }
    } catch (childErr) {
      console.error(`[createChildEnrollments] ERROR pvId=${childPvId}:`, childErr.message)
    }
  }

  if (createdChildren.length > 0) {
    const childList = createdChildren
      .sort((a, b) => a.order - b.order)
      .map(c => `${c.code} (${c.order}/${totalChildren})`)
      .join(', ')
    await logAudit({
      enrollmentId,
      action: 'children_created',
      userId,
      details: `Seguimiento${isE0 ? ' E0' : ''}: ${childList}`
    })
  }

  if (ctx.validatedSet.size > 0) {
    await logAudit({
      enrollmentId,
      action: 'validation_applied',
      userId,
      details: `Convalidacion aplicada: ${ctx.validatedSet.size} modulo(s) convalidados, ${createdChildren.length} modulo(s) inscritos`
    })
  }

  return { isE0, createdChildren }
}

function generatePassword (length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let pwd = ''
  for (let i = 0; i < length; i++) pwd += chars[Math.floor(Math.random() * chars.length)]
  return pwd
}

function buildOdooEmailBase (firstName, lastName) {
  const normalize = s => (s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '').trim()
  const first = normalize(firstName).split(/\s+/)[0] || ''
  const last = normalize(lastName).split(/\s+/)[0] || ''
  return { base: `${last}.${first}`, domain: '@weeducacion.edu.pe' }
}

async function buildUniqueOdooEmail (firstName, lastName, documentNumber) {
  const { base, domain } = buildOdooEmailBase(firstName, lastName)
  const candidateEmail = `${base}${domain}`

  const { rows: ownEnroll } = await pool.query(`
    SELECT odoo_email FROM enrollments
    WHERE odoo_email = $1
    AND enrollment_id IN (
      SELECT e.enrollment_id FROM enrollments e
      JOIN customers c ON c.customer_id = e.customer_id
      JOIN persons p ON p.person_id = c.person_id
      WHERE p.document_number = $2
    )
    LIMIT 1
  `, [candidateEmail, documentNumber])

  if (ownEnroll?.length > 0) return candidateEmail

  const isEmailAvailable = async (email) => {
    const { rows: inDb } = await pool.query(
      'SELECT enrollment_id FROM enrollments WHERE odoo_email = $1 LIMIT 1',
      [email]
    )
    if (inDb?.length) return false
    try {
      const odooUser = await odooClient.searchUserByEmail(email)
      if (odooUser) return false
    } catch (err) {
      console.warn('[buildUniqueOdooEmail] Odoo lookup failed, assuming available:', err.message)
    }
    return true
  }

  if (await isEmailAvailable(candidateEmail)) return candidateEmail

  for (let i = 2; i <= 20; i++) {
    const altEmail = `${base}${i}${domain}`
    if (await isEmailAvailable(altEmail)) return altEmail
  }

  const suffix = documentNumber ? documentNumber.slice(-3) : String(Date.now()).slice(-4)
  return `${base}.${suffix}${domain}`
}

async function enrollInOdoo ({ enrollmentId }) {
  // Skip si la inscripcion esta en E0 (program_edition_id NULL) Y es padre con hijos.
  // En ese caso los hijos se inscriben individualmente; el padre no se sincroniza con Odoo.
  const { rows: e0Check } = await pool.query(`
    SELECT e.program_edition_id,
           (SELECT COUNT(*) FROM program_version_structure
             WHERE parent_program_version_id = e.program_version_id)::INT AS children_count
      FROM enrollments e
     WHERE e.enrollment_id = $1
  `, [enrollmentId])
  if (e0Check?.[0] && e0Check[0].program_edition_id == null && e0Check[0].children_count > 0) {
    console.log(`[enrollInOdoo] Skip - enrollment #${enrollmentId} en E0 (padre sin edicion programada). Hijos se inscriben individualmente.`)
    return { success: true, skipped: true, reason: 'e0_parent', odoo_user_id: null }
  }

  const { rows: chk } = await pool.query(`
    SELECT pv.abbreviation, prog.is_membership,
           e.odoo_order_id, e.odoo_user_id, e.odoo_student_id, e.odoo_email
    FROM enrollments e
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN programs prog ON prog.program_id = pv.program_id
    WHERE e.enrollment_id = $1
  `, [enrollmentId])
  if (chk?.[0] && isMembership(chk[0].abbreviation, chk[0].is_membership)) {
    return enrollMembershipInOdoo({ enrollmentId })
  }
  if (chk?.[0]?.odoo_order_id) {
    console.log(`[enrollInOdoo] Skip — enrollment ${enrollmentId} ya tiene odoo_order_id=${chk[0].odoo_order_id}`)
    return {
      success: true,
      skipped: true,
      odoo_user_id: chk[0].odoo_user_id,
      odoo_student_id: chk[0].odoo_student_id,
      odoo_email: chk[0].odoo_email,
      order_id: chk[0].odoo_order_id
    }
  }

  const { rows } = await pool.query(`
    SELECT e.enrollment_id, e.program_edition_id,
           per.first_name, per.last_name, per.document_number,
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

  const data = rows?.[0]
  if (!data) throw new Error('Inscripcion no encontrada')

  const odooActivation = (data.odoo_activation || '').trim()
  if (!odooActivation) throw new Error('El programa no tiene configurado odoo_activation')

  const onlineModalityId = await getCatalogIdByAlias(ALIAS.MODALITY_ONLINE)
  const isOnline = data.cat_model_modality === onlineModalityId

  const { rows: prevOdoo } = await pool.query(`
    SELECT e.odoo_user_id FROM enrollments e
    JOIN customers c ON c.customer_id = e.customer_id
    JOIN persons p ON p.person_id = c.person_id
    WHERE p.document_number = $1 AND e.odoo_user_id IS NOT NULL
    ORDER BY e.enrollment_id DESC LIMIT 1
  `, [data.document_number])

  const createEmail = await buildUniqueOdooEmail(data.first_name, data.last_name, data.document_number)

  // Resolucion del searchEmail (login a buscar en Odoo) en orden de prioridad:
  //   1) Login del odoo_user_id que TENEMOS guardado para este DNI en otro
  //      enrollment previo. Es la fuente mas confiable porque la mapeamos nosotros.
  //   2) origin_email del alumno (su correo real, ej. gmail). Cubre el caso de
  //      alumnos que ya tienen cuenta Odoo desde flujos antiguos (GAS, manual,
  //      otro sistema) que nuestra BD nunca registro. Antes saltabamos esto y
  //      siempre creabamos user nuevo -> duplicados con login sintetico que
  //      nadie usa, contraseña 1234567 que tampoco funciona porque el alumno
  //      ya tenia una real desde antes.
  //   3) Synthetic createEmail (apellido.nombre@weeducacion.edu.pe) — fallback
  //      cuando es un alumno realmente nuevo.
  //
  // El search en Odoo es por `res.users.login` (clave unica), no por
  // `partner.email` — ese es el motivo del filtro estricto explicado en
  // odooClient.searchUserByEmail.
  let searchEmail = createEmail
  if (prevOdoo?.[0]?.odoo_user_id) {
    const existingUser = await odooClient.callKw('res.users', 'read', [
      [prevOdoo[0].odoo_user_id], ['login']
    ]).catch(() => null)
    if (existingUser?.[0]?.login) {
      searchEmail = existingUser[0].login
    }
  } else if (data.origin_email) {
    const realEmail = String(data.origin_email).trim().toLowerCase()
    if (realEmail) {
      const existingByReal = await odooClient.searchUserByEmail(realEmail).catch(() => null)
      if (existingByReal?.login) {
        console.log(`[enrollInOdoo] enrollment ${enrollmentId}: alumno antiguo encontrado en Odoo por origin_email (${realEmail}) -> user ${existingByReal.id}`)
        searchEmail = existingByReal.login
      }
    }
  }
  const fullName = `${(data.last_name || '').trim()} ${(data.first_name || '').trim()}`.trim().toUpperCase()
  const password = '1234567'

  let searchName
  let slideGroupId = null
  let slideChannelId = null
  let result

  if (isOnline) {
    searchName = odooActivation
    const channels = await odooClient.searchSlideChannelByName(odooActivation)
    const channelMatch = channels.find(c => c.name === odooActivation) || channels[0]
    if (!channelMatch) throw new Error(`Curso online no encontrado en Odoo: "${odooActivation}"`)
    slideChannelId = channelMatch.id

    result = await odooClient.syncStudentToOdooOnline({
      searchEmail,
      createEmail,
      fullName,
      password,
      slideChannelId,
      phone: data.origin_phone,
      documentNumber: data.document_number
    })
  } else {
    const startDate = data.start_date
    if (!startDate) throw new Error('La edicion no tiene fecha de inicio')
    const d = new Date(startDate)
    const dd = String(d.getUTCDate()).padStart(2, '0')
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
    searchName = `${odooActivation} (${dd}/${mm}) - ${monthNames[d.getUTCMonth()]} ${d.getUTCFullYear()}`

    const groups = await odooClient.searchSlideGroup(odooActivation)
    const match = groups.find(g => g.name === searchName)
    if (!match) throw new Error(`Curso no encontrado en Odoo: "${searchName}"`)
    slideGroupId = match.id

    result = await odooClient.syncStudentToOdoo({
      searchEmail,
      createEmail,
      fullName,
      password,
      slideGroupId,
      phone: data.origin_phone,
      documentNumber: data.document_number
    })
  }

  if (result.success) {
    const odooEmailFinal = result.odoo_login || createEmail
    await pool.query(`
      UPDATE enrollments SET
        odoo_user_id = $1,
        odoo_student_id = $2,
        odoo_password = $3,
        odoo_email = $5
      WHERE enrollment_id = $4
    `, [result.odoo_user_id, result.odoo_student_id, result.password_set || null, enrollmentId, odooEmailFinal])

    try {
      const { rows: instRows } = await pool.query(`
        SELECT installment_number, amount, due_date FROM payment_installments
        WHERE enrollment_id = $1 AND installment_number > 0 ORDER BY installment_number
      `, [enrollmentId])

      const { rows: enrollData } = await pool.query(`
        SELECT e.total_amount, e.discount_amount, e.list_price, c.alias AS currency_alias
        FROM enrollments e
        LEFT JOIN catalog c ON c.catalog_id = e.cat_currency
        WHERE e.enrollment_id = $1
      `, [enrollmentId])
      const netAmount = Number(enrollData?.[0]?.total_amount) || 0
      const currencyCode = enrollData?.[0]?.currency_alias === 'we_currency_usd' ? 'USD' : 'PEN'

      const orderResult = await odooClient.createSaleOrderWithFees({
        partnerId: result.odoo_partner_id,
        productName: odooActivation,
        slideGroupId,
        amount: netAmount,
        currency: currencyCode,
        partnerEmail: createEmail,
        installments: instRows.length > 0 ? instRows.map(i => ({
          amount: Number(i.amount),
          due_date: i.due_date ? new Date(i.due_date).toISOString().slice(0, 10) : null
        })) : null
      })

      if (orderResult.success) {
        await pool.query(`UPDATE enrollments SET odoo_order_id = $1 WHERE enrollment_id = $2`, [orderResult.order_id, enrollmentId])

        // Activar cuotas: pasar de 'borrador' a 'pendiente' inmediatamente.
        // Aplica para TODOS los flujos (FICO directo, courseChange, E0 children, etc.)
        // sin esperar a confirmPayment.
        await safeAsync('[enrollInOdoo][Odoo] activateFees', async () => {
          const activated = await odooClient.activateFees(orderResult.order_id)
          if (activated?.activated > 0) {
            await logAudit({
              enrollmentId,
              action: 'odoo_fees_activated',
              userId: null,
              details: `${activated.activated} cuota(s) Odoo activadas (Borrador -> Pendiente)`
            })
          }
        })
      }
    } catch (orderErr) {
      console.error('[enrollInOdoo] Error creando orden de venta:', orderErr.message, orderErr.data || '')
    }
  }

  if (result.success) {
    await logAudit({ enrollmentId, action: 'odoo_enrolled', userId: null, details: `Inscrito en Odoo: user ${result.odoo_user_id}, curso ${searchName}` })
  }

  return {
    ...result,
    student_name: fullName,
    student_email: searchEmail,
    odoo_email: createEmail,
    course_search: searchName
  }
}

async function bankAccountList () {
  const { rows } = await pool.query(
    `SELECT account_id, business_entity_catalog_id, bank_name, currency, account_number, cci_number
     FROM public.bank_accounts WHERE active = 'Y' ORDER BY business_entity_catalog_id, bank_name`
  )
  return rows || []
}

async function previewConfirmationEmail ({ enrollmentId }) {
  // Si es membresia, derivar al preview de membresia (otra plantilla, otros datos).
  const { rows: checkRows } = await pool.query(`
    SELECT pv.abbreviation, prog.is_membership FROM enrollments e
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN programs prog ON prog.program_id = pv.program_id
    WHERE e.enrollment_id = $1
  `, [enrollmentId])
  if (checkRows?.[0] && isMembership(checkRows[0].abbreviation, checkRows[0].is_membership)) {
    return previewMembershipEmail({ enrollmentId })
  }

  const { rows } = await pool.query(`
    SELECT e.enrollment_id, e.total_amount, e.discount_amount,
           per.first_name, per.last_name, per.document_number,
           ${STUDENT_EMAIL_SQL} AS origin_email,
           pv.abbreviation AS program_name,
           prog.banner_link,
           prog.cat_model_modality,
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
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN programs prog ON prog.program_id = pv.program_id
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN catalog curr ON e.cat_currency = curr.catalog_id
    LEFT JOIN catalog c_plan ON c_plan.catalog_id = e.cat_payment_plan
    WHERE e.enrollment_id = $1
  `, [enrollmentId])

  const data = rows?.[0]
  if (!data) return { html: null, error: 'Inscripcion no encontrada' }

  const onlineModalityIdPreview = await getCatalogIdByAlias(ALIAS.MODALITY_ONLINE)
  const isOnlinePreview = data.cat_model_modality === onlineModalityIdPreview

  const { rows: schedRows } = await pool.query(`
    SELECT c.description AS day_name, es.start_time, es.end_time
    FROM edition_schedules es
    LEFT JOIN catalog c ON es.cat_day_id = c.catalog_id
    WHERE es.edition_num_id = (SELECT program_edition_id FROM enrollments WHERE enrollment_id = $1)
    ORDER BY es.schedule_id
  `, [enrollmentId])

  const sched = schedRows || []
  const frequency = sched.map(s => s.day_name).filter(Boolean).join(', ')
  const schedule = sched.length > 0 ? `${sched[0].start_time || ''} - ${sched[0].end_time || ''}` : ''

  const { rows: instRows } = await pool.query(`
    SELECT installment_number, amount, due_date
    FROM payment_installments WHERE enrollment_id = $1 AND installment_number > 0 ORDER BY installment_number
  `, [enrollmentId])

  const firstName = (data.first_name || '').trim().split(/\s+/)[0] || ''
  const lastName = (data.last_name || '').trim().split(/\s+/)[0] || ''
  const odooEmail = data.odoo_email || `${lastName.toLowerCase()}.${firstName.toLowerCase()}@weeducacion.edu.pe`

  // Mismo check que el envio real: si ya hubo un envio exitoso, el preview muestra
  // el bloque "cuenta activa, recupera password". Si nunca se envio, muestra
  // credenciales (asumiendo que sera primer envio al confirmar).
  const { rows: priorSendsPreview } = await pool.query(`
    SELECT 1 FROM public.email_logs
    WHERE enrollment_id = $1 AND template_type = 'confirmacion' AND status = 'sent'
    LIMIT 1
  `, [enrollmentId])
  const isNew = !priorSendsPreview?.[0]

  const { rows: childCheck } = await pool.query(`
    SELECT 1 FROM program_version_structure pvs
    JOIN enrollments e ON e.program_version_id = pvs.parent_program_version_id
    WHERE e.enrollment_id = $1
    LIMIT 1
  `, [enrollmentId])
  const isParentProgram = childCheck.length > 0

  // Para programas padre siempre ocultamos WhatsApp y mostramos mensaje de cronograma
  // adjunto (igual que el envio real, aunque el PDF se construye en send time).
  const htmlBody = isOnlinePreview
    ? buildConfirmacionOnlineHTML({
        studentName: `${firstName} ${lastName}`,
        programName: data.program_name,
        email: odooEmail,
        isNew
      })
    : buildConfirmacionHTML({
        studentName: `${firstName} ${lastName}`,
        programName: data.program_name,
        startDate: data.start_date,
        frequency, schedule,
        whatsappLink: data.whatsapp_link || '',
        email: odooEmail,
        isNew,
        bannerUrl: data.banner_link || '',
        installments: data.payment_plan_alias === 'we_payment_way_single' ? [] : (instRows || []),
        currencySymbol: data.currency_symbol || 'S/.',
        hideWhatsapp: isParentProgram
      })

  return {
    html: htmlBody,
    to: data.origin_email || '---',
    subject: `Confirmacion de Inscripcion - ${data.program_name || 'WE Educacion'}`,
    hasAttachment: isParentProgram && !isOnlinePreview,
    attachmentName: (isParentProgram && !isOnlinePreview) ? `Cronograma-${(data.program_name || 'Programa').replace(/[^a-zA-Z0-9]+/g, '-')}.pdf` : null
  }
}

async function previewMembershipEmail ({ enrollmentId }) {
  const { rows } = await pool.query(`
    SELECT e.enrollment_id, per.first_name, per.last_name, per.document_number,
           ${STUDENT_EMAIL_SQL} AS origin_email,
           pv.abbreviation AS program_name,
           pe.start_date, e.odoo_user_id, e.odoo_email, e.odoo_password,
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

  const data = rows?.[0]
  if (!data) return { html: null, error: 'Inscripcion no encontrada' }

  const startDate = data.start_date ? new Date(data.start_date) : new Date()
  const fechaAct = formatCalendarDate(startDate)
  const fechaRenov = formatCalendarDate(addMonthsCalendar(startDate, MEMBERSHIP_DURATION_MONTHS))

  const firstName = (data.first_name || '').trim().split(/\s+/)[0] || ''
  const lastName  = (data.last_name  || '').trim().split(/\s+/)[0] || ''
  // Para PREVIEW si aun no se sincronizo, usamos el email proyectado (lastname.firstname).
  // Esto solo se muestra en preview — el envio real falla si no hay odoo_email persistido.
  const odooEmail = data.odoo_email || `${lastName.toLowerCase()}.${firstName.toLowerCase()}@weeducacion.edu.pe`

  // Cuotas: solo si el plan es por cuotas. Pago al contado oculta la tabla.
  let installmentsHTML = ''
  const isSinglePayment = data.payment_plan_alias === 'we_payment_way_single'
  if (!isSinglePayment) {
    const { rows: instRows } = await pool.query(`
      SELECT installment_number, amount, due_date
      FROM payment_installments WHERE enrollment_id = $1 AND installment_number > 0
      ORDER BY installment_number
    `, [enrollmentId])

    if (instRows && instRows.length > 0) {
      const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
      const fechasCells = instRows.map(i => {
        const d = new Date(i.due_date)
        return `<td><font face="Tahoma" size="2">${String(d.getUTCDate()).padStart(2,'0')} ${meses[d.getUTCMonth()]}</font></td>`
      }).join('')
      const pagosCells = instRows.map(i => `<td><font face="Tahoma" size="2">${data.currency_symbol || 'S/.'} ${Math.trunc(Number(i.amount || 0))}</font></td>`).join('')
      installmentsHTML = `
        <table width="450" border="2" align="center" style="border-collapse:collapse;text-align:center;">
          <thead><tr><td colspan="${instRows.length + 1}" style="background-color:rgb(5,36,103);color:white;"><font face="Tahoma" size="2">CRONOGRAMA DE PAGOS</font></td></tr></thead>
          <tbody>
            <tr><td style="background-color:rgb(5,36,103);color:white;"><font face="Tahoma" size="2">Fechas</font></td>${fechasCells}</tr>
            <tr><td style="background-color:rgb(5,36,103);color:white;"><font face="Tahoma" size="2">Pago</font></td>${pagosCells}</tr>
          </tbody>
        </table>`
    }
  }

  // Mismo check que el envio real: si ya hubo un envio exitoso para esta
  // inscripcion, el preview muestra el bloque de "cuenta activa, recupera tu
  // password" — lo que el alumno realmente recibira al darle reenviar.
  const { rows: priorSendsPreview } = await pool.query(`
    SELECT 1 FROM public.email_logs
    WHERE enrollment_id = $1 AND template_type = 'membresia' AND status = 'sent'
    LIMIT 1
  `, [enrollmentId])
  const isFirstSendPreview = !priorSendsPreview?.[0]

  const htmlBody = buildMembresiaHTML({
    studentName: `${data.first_name} ${data.last_name}`,
    programName: data.program_name,
    email: odooEmail,
    password: '1234567',
    isNew: isFirstSendPreview,
    duracion: `${MEMBERSHIP_DURATION_MONTHS} meses`,
    fechaActivacion: fechaAct,
    fechaRenovacion: fechaRenov,
    installmentsHTML,
    bloqueBeneficios: undefined,
    fichaRegistroLink: undefined
  })

  const tipo = detectMembershipType(data.program_name)
  return {
    html: htmlBody,
    to: data.origin_email || '---',
    subject: `Bienvenido a tu Membresia ${tipo} - WE Educacion`,
    hasAttachment: false,
    attachmentName: null
  }
}

async function sendConfirmationEmail ({ enrollmentId, cc }) {
  // Reintento manual: dejar la timeline limpia. Si el envio nuevo falla, solo
  // veremos esa falla; si tiene exito, no queda rastro de intentos previos
  // fallidos. Cubre tambien la rama de membresia que sale por aqui.
  await clearPriorEmailFailures(enrollmentId)

  const { rows: checkRows } = await pool.query(`
    SELECT pv.abbreviation, prog.is_membership, e.odoo_user_id
    FROM enrollments e
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN programs prog ON prog.program_id = pv.program_id
    WHERE e.enrollment_id = $1
  `, [enrollmentId])
  if (checkRows?.[0] && isMembership(checkRows[0].abbreviation, checkRows[0].is_membership)) {
    return sendMembershipEmail({ enrollmentId })
  }

  // Si el enrollment no tiene odoo_user_id (la creacion en Odoo se salto durante
  // confirmPayment, ej. fallo de red o el SP marco un order_id placeholder),
  // intentamos crearlo aqui antes de mandar el correo. El correo expone
  // USUARIO+CONTRASEÑA del campus — sin Odoo creado esas credenciales son
  // ficticias. Mejor reintentar que mandar credenciales muertas.
  if (checkRows?.[0] && !checkRows[0].odoo_user_id) {
    console.log(`[sendConfirmationEmail] enrollment ${enrollmentId}: sin odoo_user_id, reintentando enrollInOdoo`)
    const odooRetry = await safeAsync('[sendConfirmationEmail][Odoo] retry', () => enrollInOdoo({ enrollmentId }))
    if (odooRetry?.success) {
      const cursoLabel = odooRetry.course_search || 'Curso no especificado'
      await logAudit({
        enrollmentId,
        action: 'odoo_enrolled',
        userId: null,
        details: `Odoo user ${odooRetry.odoo_user_id} - ${cursoLabel} (creado en reintento desde reenviar correo)`
      })
    } else {
      console.error(`[sendConfirmationEmail] enrollInOdoo retry no exitoso para ${enrollmentId}:`, odooRetry?.error || 'sin respuesta')
      return {
        success: false,
        error: `No se pudo crear el alumno en Odoo (${odooRetry?.error || 'fallo desconocido'}). El correo NO fue enviado para evitar credenciales falsas.`
      }
    }
  }

  const { rows } = await pool.query(`
    SELECT e.enrollment_id, e.total_amount, e.discount_amount,
           per.first_name, per.last_name, per.document_number,
           ${STUDENT_EMAIL_SQL} AS origin_email,
           pv.abbreviation AS program_name,
           prog.banner_link,
           prog.cat_model_modality,
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
    LEFT JOIN catalog c_plan ON c_plan.catalog_id = e.cat_payment_plan
    WHERE e.enrollment_id = $1
  `, [enrollmentId])

  const data = rows?.[0]
  if (!data) return { success: false, error: 'Inscripcion no encontrada' }

  const onlineModalityIdSend = await getCatalogIdByAlias(ALIAS.MODALITY_ONLINE)
  const isOnlineSend = data.cat_model_modality === onlineModalityIdSend

  const toEmail = data.origin_email
  if (!toEmail) {
    await logAudit({
      enrollmentId,
      action: 'email_failed',
      userId: null,
      details: 'Error al enviar correo: el alumno no tiene correo registrado'
    }).catch(() => {})
    return { success: false, error: 'El estudiante no tiene correo registrado' }
  }

  const { rows: schedRows } = await pool.query(`
    SELECT c.description AS day_name, es.start_time, es.end_time
    FROM edition_schedules es
    LEFT JOIN catalog c ON es.cat_day_id = c.catalog_id
    WHERE es.edition_num_id = (SELECT program_edition_id FROM enrollments WHERE enrollment_id = $1)
    ORDER BY es.schedule_id
  `, [enrollmentId])

  const sched = schedRows || []
  const frequency = sched.map(s => s.day_name).filter(Boolean).join(', ')
  const schedule = sched.length > 0 ? `${sched[0].start_time || ''} - ${sched[0].end_time || ''}` : ''

  const { rows: instRows } = await pool.query(`
    SELECT installment_number, amount, due_date
    FROM payment_installments
    WHERE enrollment_id = $1 AND installment_number > 0
    ORDER BY installment_number
  `, [enrollmentId])

  const firstName = (data.first_name || '').trim().split(/\s+/)[0] || ''
  const lastName = (data.last_name || '').trim().split(/\s+/)[0] || ''

  const { rows: freshEnroll } = await pool.query(
    'SELECT odoo_user_id, odoo_email, odoo_password FROM enrollments WHERE enrollment_id = $1', [enrollmentId]
  )
  const odooEmail = freshEnroll?.[0]?.odoo_email || data.odoo_email || `${lastName.toLowerCase()}.${firstName.toLowerCase()}@weeducacion.edu.pe`

  // Resend detection: si ya hubo un envio exitoso ('confirmacion' status='sent')
  // para esta inscripcion, lo tratamos como reenvio -> bloque "ya estas registrado,
  // recupera password aqui" en lugar de exponer credenciales otra vez.
  const { rows: priorSends } = await pool.query(`
    SELECT 1 FROM public.email_logs
    WHERE enrollment_id = $1 AND template_type = 'confirmacion' AND status = 'sent'
    LIMIT 1
  `, [enrollmentId])
  const isFirstSend = !priorSends?.[0]

  // `isNew` controla si el correo lleva credenciales (USUARIO + 1234567) o el
  // bloque "tu cuenta ya existe, recupera tu password". Dos vias para detectar
  // alumno antiguo:
  //   1) Tiene OTRO enrollment previo en NUESTRA BD con odoo_user_id seteado.
  //   2) El odoo_email del enrollment actual es el correo personal del alumno
  //      (no el synthetic apellido.nombre@weeducacion.edu.pe). Eso pasa cuando
  //      enrollInOdoo enlazo a un res.users que ya existia en Odoo desde antes
  //      (creado por flujo viejo / GAS / manual). En ese caso el alumno ya
  //      tiene su contraseña real, mandar 1234567 lo confunde.
  const { rows: priorOdoo } = await pool.query(`
    SELECT 1
    FROM enrollments e
    WHERE e.customer_id = (SELECT customer_id FROM enrollments WHERE enrollment_id = $1)
      AND e.enrollment_id <> $1
      AND e.odoo_user_id IS NOT NULL
    LIMIT 1
  `, [enrollmentId])
  const hasPriorEnrollment = !!priorOdoo?.[0]
  const SYNTHETIC_DOMAIN = '@weeducacion.edu.pe'
  const linkedToExistingOdoo = !!odooEmail && !String(odooEmail).toLowerCase().endsWith(SYNTHETIC_DOMAIN)
  const isReturningStudent = hasPriorEnrollment || linkedToExistingOdoo
  const isNew = isFirstSend && !isReturningStudent

  const { rows: childCheck } = await pool.query(`
    SELECT 1 FROM program_version_structure pvs
    JOIN enrollments e ON e.program_version_id = pvs.parent_program_version_id
    WHERE e.enrollment_id = $1
    LIMIT 1
  `, [enrollmentId])
  const isParentProgram = childCheck.length > 0

  // PDF de cronograma: SOLO los programas padre (ESP/PEE/Diplomado) lo
  // adjuntan, porque cubren multiples modulos y el alumno necesita ver el
  // calendario completo. Si el PDF falla, NO mandamos el correo — preferimos
  // bloquear y avisar al operador antes que entregar un correo incompleto al
  // alumno (mismo razonamiento que con el reintento de Odoo: no shipear
  // artefactos rotos en silencio).
  const attachments = []
  if (isParentProgram && !isOnlineSend) {
    console.log(`[sendConfirmationEmail] Generando PDF cronograma para parent enrollment #${enrollmentId}`)
    let pdfBuffer
    try {
      pdfBuffer = await generateCronogramaPdf({ enrollmentId })
    } catch (pdfErr) {
      console.error(`[sendConfirmationEmail] Error generando PDF cronograma para enrollment #${enrollmentId}:`, pdfErr.message, pdfErr.stack)
      return {
        success: false,
        error: `No se pudo generar el PDF de cronograma (${pdfErr.message}). El correo NO fue enviado para evitar entregar al alumno un correo de programa padre sin su cronograma adjunto.`
      }
    }
    if (!pdfBuffer || pdfBuffer.length === 0) {
      console.error(`[sendConfirmationEmail] PDF cronograma vacio para enrollment #${enrollmentId}`)
      return {
        success: false,
        error: 'El PDF de cronograma se genero vacio (0 bytes). El correo NO fue enviado.'
      }
    }
    const safeName = (data.program_name || 'Programa').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
    attachments.push({
      filename: `Cronograma-${safeName}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf'
    })
    console.log(`[sendConfirmationEmail] PDF cronograma generado OK (${pdfBuffer.length} bytes) para enrollment #${enrollmentId}`)
  }

  // Para programas padre (ESP/PEE/DIPLOMADO), siempre ocultamos el bloque de WhatsApp
  // porque cada hijo tiene su propio grupo. NO depende de si el PDF se adjunto o no
  // (si fallo el PDF, igual queremos ocultar WhatsApp; el alumno puede pedir el
  // cronograma despues, pero el bloque de "unete a WhatsApp" no aplica al padre).
  const htmlBody = isOnlineSend
    ? buildConfirmacionOnlineHTML({
        studentName: `${firstName} ${lastName}`,
        programName: data.program_name,
        email: odooEmail,
        isNew
      })
    : buildConfirmacionHTML({
        studentName: `${firstName} ${lastName}`,
        programName: data.program_name,
        startDate: data.start_date,
        frequency,
        schedule,
        whatsappLink: data.whatsapp_link || '',
        email: odooEmail,
        isNew,
        bannerUrl: data.banner_link || '',
        installments: data.payment_plan_alias === 'we_payment_way_single' ? [] : (instRows || []),
        currencySymbol: data.currency_symbol || 'S/.',
        hideWhatsapp: isParentProgram
      })

  // Resolucion del CC en cascada: parametro explicito (override puntual) ->
  // valor persistido en enrollments.email_cc (capturado en la inscripcion).
  // El parser tolera null/undefined y descarta entradas invalidas.
  const ccResolved = parseEmailCc(cc != null ? cc : data.email_cc)
  const ccForTransport = ccResolved.length > 0 ? ccResolved : undefined

  const subject = `Confirmacion de Inscripcion - ${data.program_name || 'WE Educacion'}`
  const result = await sendEmail({ to: toEmail, subject, htmlBody, attachments, cc: ccForTransport })

  try {
    await pool.query(`
      INSERT INTO public.email_logs (enrollment_id, to_email, subject, message_id, template_type, status)
      VALUES ($1, $2, $3, $4, 'confirmacion', $5)
    `, [enrollmentId, toEmail, subject, result.messageId || null, result.success ? 'sent' : 'failed'])
  } catch (logErr) {
    console.error('[EmailLog] Error registrando log:', logErr.message)
  }

  const ccDetail = ccResolved.length > 0 ? ` (cc: ${ccResolved.join(',')})` : ''
  if (result.success) {
    await logAudit({ enrollmentId, action: 'email_sent', userId: null, details: `Correo confirmacion enviado a ${toEmail}${ccDetail}` })
  } else {
    await logAudit({
      enrollmentId,
      action: 'email_failed',
      userId: null,
      details: `Error al enviar correo a ${toEmail}: ${result.error || 'desconocido'}`
    })
  }

  return result
}

async function getEmailLogs ({ enrollmentId }) {
  const { rows } = await pool.query(`
    SELECT email_log_id, to_email, subject, template_type, status,
           sent_at, delivered_at, opened_at, clicked_at, bounced_at,
           open_count, click_count, bounce_reason
    FROM public.email_logs
    WHERE enrollment_id = $1
    ORDER BY sent_at DESC
  `, [enrollmentId])
  return rows || []
}

async function sendPaymentConfirmationEmail ({ enrollmentId }) {
  const { rows } = await pool.query(`
    SELECT e.enrollment_id,
           per.first_name, per.last_name,
           ${STUDENT_EMAIL_SQL} AS origin_email,
           pv.abbreviation AS program_name,
           curr.variable_2 AS currency_symbol,
           CASE WHEN c_plan.alias = 'we_payment_way_single' THEN 'curso' ELSE 'curso' END AS program_type
    FROM enrollments e
    JOIN customers cust ON cust.customer_id = e.customer_id
    JOIN persons per ON per.person_id = cust.person_id
    LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN catalog curr ON e.cat_currency = curr.catalog_id
    LEFT JOIN catalog c_plan ON c_plan.catalog_id = e.cat_payment_plan
    WHERE e.enrollment_id = $1
  `, [enrollmentId])

  const data = rows?.[0]
  if (!data) return { success: false, error: 'Inscripcion no encontrada' }

  const toEmail = data.origin_email
  if (!toEmail) return { success: false, error: 'El estudiante no tiene correo registrado' }

  const { rows: instRows } = await pool.query(`
    SELECT installment_number, amount, due_date, status
    FROM payment_installments
    WHERE enrollment_id = $1 AND installment_number > 0
    ORDER BY installment_number
  `, [enrollmentId])

  const installments = instRows || []
  const paidCount = installments.filter(i => i.status === 'paid').length
  const isLastPayment = paidCount >= installments.length
  const nextInstallment = installments.find(i => i.status !== 'paid')
  const lastPaid = [...installments].reverse().find(i => i.status === 'paid')

  const htmlBody = buildConfirmacionPagoHTML({
    studentName: `${data.first_name} ${data.last_name}`,
    programType: data.program_type || 'curso',
    isLastPayment,
    lastPaymentDate: lastPaid?.due_date || new Date().toISOString(),
    nextPaymentDate: nextInstallment?.due_date || null,
    nextPaymentAmount: nextInstallment?.amount || 0,
    currencySymbol: data.currency_symbol || 'S/.'
  })

  const subject = isLastPayment
    ? `Pago Completado - ${data.program_name || 'WE Educacion'}`
    : `Confirmacion de Cuota - ${data.program_name || 'WE Educacion'}`

  const result = await sendFicoEmail({ to: toEmail, subject, htmlBody })

  try {
    await pool.query(`
      INSERT INTO public.email_logs (enrollment_id, to_email, subject, message_id, template_type, status)
      VALUES ($1, $2, $3, $4, 'confirmacion_pago', $5)
    `, [enrollmentId, toEmail, subject, result.messageId || null, result.success ? 'sent' : 'failed'])
  } catch (logErr) {
    console.error('[EmailLog] Error registrando log:', logErr.message)
  }

  return result
}

async function logAudit ({ enrollmentId, action, userId, justificacion = null, changes = null, details = null }) {
  try {
    await pool.query(`
      INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
    `, [enrollmentId, action, userId, justificacion, changes ? JSON.stringify(changes) : null, details])
  } catch (err) {
    console.error('[AuditLog] Error:', err.message)
  }
}

// Antes de un reenvio manual de correo, limpiamos los fallos anteriores. Mantiene
// la timeline limpia y deja `isFirstSend` consistente: el flag ya ignoraba rows
// con status='failed', pero los borramos tambien para que la fila no aparezca
// como "intento previo" si alguien consulta email_logs directo.
// Solo borra fallos — los envios exitosos y otros eventos (approved, odoo_sync,
// etc.) quedan intactos.
async function clearPriorEmailFailures (enrollmentId) {
  try {
    await pool.query(
      `DELETE FROM enrollment_audit_log WHERE enrollment_id = $1 AND action = 'email_failed'`,
      [enrollmentId]
    )
    await pool.query(
      `DELETE FROM email_logs WHERE enrollment_id = $1 AND status = 'failed'`,
      [enrollmentId]
    )
  } catch (err) {
    console.error('[clearPriorEmailFailures]', err.message)
  }
}

async function getAuditLog ({ enrollmentId }) {
  const { rows } = await pool.query(`
    SELECT al.audit_id, al.action, al.performed_at, al.justificacion, al.changes, al.details,
           u.alias AS user_name
    FROM enrollment_audit_log al
    LEFT JOIN users u ON u.user_id = al.performed_by
    WHERE al.enrollment_id = $1
    ORDER BY al.performed_at DESC
  `, [enrollmentId])
  return rows || []
}

async function resolveLabel (catalogId) {
  if (!catalogId) return null
  const { rows } = await pool.query('SELECT description FROM catalog WHERE catalog_id = $1', [catalogId])
  return rows?.[0]?.description || String(catalogId)
}

async function confirmInstallment ({ installmentId, enrollmentId, catCurrency, catPaymentMedium, catBusinessEntity, bankAccountId, transactionCode, voucherUrl, paymentDate, userId }) {
  const { rows: instRows } = await pool.query(
    'SELECT * FROM payment_installments WHERE installment_id = $1 AND enrollment_id = $2',
    [installmentId, enrollmentId]
  )
  const inst = instRows?.[0]
  if (!inst) throw new Error('Cuota no encontrada')
  if (inst.cat_status === 4454) throw new Error('Esta cuota ya esta pagada')

  await pool.query(
    'UPDATE payment_installments SET cat_status = 4454 WHERE installment_id = $1',
    [installmentId]
  )

  const paidAt = paymentDate ? new Date(paymentDate) : new Date()

  await pool.query(`
    INSERT INTO payments (enrollment_id, installment_id, amount, payment_date, transaction_code,
      cat_method_payment, cat_payment_type, cat_settlement_status,
      settled_in_account_id, evidence_url, active, user_registration_id, registration_date)
    VALUES ($1, $2, $3, $4, $5, $6, 3115, 2573, $7, $8, 'Y', $9, NOW())
  `, [enrollmentId, installmentId, inst.amount, paidAt, transactionCode || '', catPaymentMedium || null, bankAccountId || null, voucherUrl || null, userId])

  if (catCurrency) {
    await pool.query('UPDATE enrollments SET cat_currency = $1 WHERE enrollment_id = $2', [catCurrency, enrollmentId])
  }

  try {
    await pool.query(
      "UPDATE payment_tokens SET status = 'confirmed', confirmed_by = $1, updated_at = NOW() WHERE enrollment_id = $2 AND status != 'confirmed'",
      [userId, enrollmentId]
    )
  } catch (e) {}

  await logAudit({
    enrollmentId,
    action: 'approved',
    userId,
    details: `Cuota ${inst.installment_number} confirmada: S/. ${inst.amount}`
  })

  try {
    const odooResult = await syncInstallmentPaymentToOdoo({ enrollmentId, installmentNumber: inst.installment_number })
    if (odooResult?.success) {
      await logAudit({ enrollmentId, action: 'odoo_fee_paid', userId, details: `Cuota ${inst.installment_number} sincronizada con Odoo (fee_id: ${odooResult.fee_id})` })
    }
  } catch (odooErr) {
    console.error('[confirmInstallment] Odoo sync:', odooErr.message)
  }

  return { result: 1, message: 'Cuota confirmada' }
}

async function resolveBankLabel (accountId) {
  if (!accountId) return null
  const { rows } = await pool.query('SELECT bank_name, currency, account_number FROM bank_accounts WHERE account_id = $1', [accountId])
  const r = rows?.[0]
  return r ? `${r.bank_name || ''} ${r.currency || ''} ${r.account_number || ''}`.trim() : String(accountId)
}

// La entidad empresa vive como FK en bank_accounts. La derivamos desde la cuenta
// porque payments no tiene columna directa de entity — el bank_account_id implica
// la entidad por la relacion. Util para el diff del audit log.
async function resolveBusinessEntityFromAccount (accountId) {
  if (!accountId) return null
  const { rows } = await pool.query(`
    SELECT c.description
    FROM bank_accounts ba
    LEFT JOIN catalog c ON c.catalog_id = ba.cat_business_entity
    WHERE ba.account_id = $1
  `, [accountId])
  return rows?.[0]?.description || null
}

async function enrollmentUpdate ({ enrollmentId, fields, justificacion, userId }) {
  const changes = {}

  const { rows: oldEnroll } = await pool.query('SELECT cat_currency FROM enrollments WHERE enrollment_id = $1', [enrollmentId])
  const { rows: oldPay } = await pool.query('SELECT payment_id, cat_method_payment, settled_in_account_id, transaction_code, payment_date FROM payments WHERE enrollment_id = $1 AND active = \'Y\' ORDER BY payment_date DESC LIMIT 1', [enrollmentId])
  const oldE = oldEnroll?.[0] || {}
  const oldP = oldPay?.[0] || {}

  const enrollmentFields = ['cat_currency', 'notes']
  const eSets = []
  const eParams = []
  let eIdx = 1
  for (const key of enrollmentFields) {
    if (fields[key] !== undefined) {
      eSets.push(`${key} = $${eIdx}`)
      eParams.push(fields[key])
      eIdx++
    }
  }
  if (eSets.length > 0) {
    eParams.push(enrollmentId)
    await pool.query(`UPDATE enrollments SET ${eSets.join(', ')} WHERE enrollment_id = $${eIdx}`, eParams)
  }

  const paymentFields = { cat_payment_medium: 'cat_method_payment', transaction_code: 'transaction_code', bank_account_id: 'settled_in_account_id', payment_date: 'payment_date' }
  const pSets = []
  const pParams = []
  let pIdx = 1
  for (const [formKey, dbKey] of Object.entries(paymentFields)) {
    if (fields[formKey] !== undefined) {
      // payment_date va como ::date para no chocar con string vacio o ISO timestamp.
      const cast = dbKey === 'payment_date' ? '::date' : ''
      pSets.push(`${dbKey} = $${pIdx}${cast}`)
      pParams.push(formKey === 'payment_date' ? (fields[formKey] || null) : fields[formKey])
      pIdx++
    }
  }
  if (pSets.length > 0 && oldP.payment_id) {
    pParams.push(oldP.payment_id)
    await pool.query(`UPDATE payments SET ${pSets.join(', ')} WHERE payment_id = $${pIdx}`, pParams)
  }

  if (fields.cat_currency !== undefined && fields.cat_currency !== oldE.cat_currency) {
    const oldLabel = await resolveLabel(oldE.cat_currency)
    const newLabel = await resolveLabel(fields.cat_currency)
    changes['Tipo Moneda'] = { old: oldLabel || '---', new: newLabel }
  }
  if (fields.cat_payment_medium !== undefined && fields.cat_payment_medium !== oldP.cat_method_payment) {
    const oldLabel = await resolveLabel(oldP.cat_method_payment)
    const newLabel = await resolveLabel(fields.cat_payment_medium)
    changes['Medio de Pago'] = { old: oldLabel || '---', new: newLabel }
  }
  if (fields.bank_account_id !== undefined && fields.bank_account_id !== oldP.settled_in_account_id) {
    const oldLabel = await resolveBankLabel(oldP.settled_in_account_id)
    const newLabel = await resolveBankLabel(fields.bank_account_id)
    changes['Cuenta Bancaria'] = { old: oldLabel || '---', new: newLabel }

    // La Entidad va emparejada con la cuenta. Solo la incluimos en el diff si
    // efectivamente cambia — picking de la misma entidad pero distinta cuenta
    // no genera linea redundante.
    const oldEntity = await resolveBusinessEntityFromAccount(oldP.settled_in_account_id)
    const newEntity = await resolveBusinessEntityFromAccount(fields.bank_account_id)
    if (oldEntity !== newEntity) {
      changes['Entidad Empresa'] = { old: oldEntity || '---', new: newEntity || '---' }
    }
  }
  if (fields.transaction_code !== undefined && fields.transaction_code !== (oldP.transaction_code || '')) {
    changes['N. Operacion'] = { old: oldP.transaction_code || '---', new: fields.transaction_code || '---' }
  }
  if (fields.payment_date !== undefined) {
    const oldDateIso = oldP.payment_date ? new Date(oldP.payment_date).toISOString().slice(0, 10) : ''
    const newDateIso = fields.payment_date ? String(fields.payment_date).slice(0, 10) : ''
    if (oldDateIso !== newDateIso) {
      const fmt = iso => iso ? iso.split('-').reverse().join('/') : '---'
      changes['Fecha de Pago'] = { old: fmt(oldDateIso), new: fmt(newDateIso) }
      // Mantener leads.pay_date alineado con el pago real para que el listado FICO
      // (cascada leads.pay_date -> payments.payment_date) muestre la misma fecha.
      try {
        await pool.query(
          `UPDATE leads SET pay_date = $2::date, user_modification_id = $3
            WHERE enrollment_id = $1`,
          [enrollmentId, newDateIso || null, userId || 9]
        )
      } catch (e) {
        console.error('[enrollmentUpdate] No se pudo sincronizar leads.pay_date:', e.message)
      }
    }
  }

  if (fields.installments && Array.isArray(fields.installments)) {
    for (const inst of fields.installments) {
      if (inst.installment_id) {
        await pool.query(`
          UPDATE payment_installments SET amount = $1, due_date = $2
          WHERE installment_id = $3 AND enrollment_id = $4
        `, [inst.amount, inst.due_date, inst.installment_id, enrollmentId])
      }
    }
    changes['Cuotas'] = { updated: fields.installments.length }
  }

  const detailLines = Object.entries(changes)
    .filter(([, v]) => v.old !== undefined && v.new !== undefined)
    .map(([k, v]) => `${k}: ${v.old} → ${v.new}`)
  const details = detailLines.length > 0 ? detailLines.join(' | ') : 'Sin cambios detectados'

  await logAudit({
    enrollmentId,
    action: 'edited',
    userId,
    justificacion,
    changes,
    details
  })

  return { result: 1, message: 'Inscripcion actualizada' }
}

async function syncInstallmentPaymentToOdoo ({ enrollmentId, installmentNumber }) {
  try {
    const { rows } = await pool.query(`
      SELECT e.odoo_user_id, e.odoo_order_id,
             pv.abbreviation, prog.odoo_activation, prog.is_membership, pe.start_date
      FROM enrollments e
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN programs prog ON prog.program_id = pv.program_id
      LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      WHERE e.enrollment_id = $1
    `, [enrollmentId])

    const data = rows?.[0]
    if (isMembership(data?.abbreviation, data?.is_membership)) return { success: false, error: 'Membresias no sincronizan cuotas con Odoo' }
    if (!data?.odoo_order_id) return { success: false, error: 'Sin orden Odoo asociada' }

    const fees = await odooClient.callKw('sale.order.fee', 'search_read', [
      [['order_id', '=', data.odoo_order_id], ['state', '=', 'pendiente']]
    ], { fields: ['id', 'seq', 'amount'], limit: 20, order: 'seq asc' })

    if (!fees || fees.length === 0) return { success: false, error: 'No hay cuotas pendientes en Odoo' }

    const fee = fees[0]
    await odooClient.markFeeAsPaid(fee.id)

    return { success: true, fee_id: fee.id, message: `Cuota ${fee.seq} marcada como pagada en Odoo` }
  } catch (err) {
    console.error('[syncInstallmentPaymentToOdoo]', err.message)
    return { success: false, error: err.message }
  }
}

/**
 * Clasifica si un programa es membresia.
 * Prioriza el flag explicito programs.is_membership (Source of Truth).
 * Solo cae al match heuristico si no se le pasa el flag (compatibilidad transicional).
 *
 * @param {string} programName - abbreviation del programa
 * @param {boolean|null} isMembershipFlag - flag desde programs.is_membership
 * @returns {boolean}
 */
function isMembership (programName, isMembershipFlag = null) {
  if (isMembershipFlag === true) return true
  if (isMembershipFlag === false) return false
  // Fallback heuristico cuando no viene el flag desde la query.
  const name = (programName || '').toUpperCase()
  return name.includes('MEMB') || name.includes('PLUS') || name.includes('PLAT') || name.includes('BLACK') || name.includes('GOLD')
}

async function enrollMembershipInOdoo ({ enrollmentId }) {
  try {
    return await _enrollMembershipInOdooInner({ enrollmentId })
  } catch (err) {
    console.error('[enrollMembershipInOdoo] Throw inesperado:', err.message, err.stack)
    return { success: false, error: `enrollMembershipInOdoo: ${err.message}`, odoo_user_id: null }
  }
}

async function _enrollMembershipInOdooInner ({ enrollmentId }) {
  const { rows } = await pool.query(`
    SELECT e.enrollment_id, per.first_name, per.last_name, per.document_number,
           ${STUDENT_EMAIL_SQL} AS origin_email,
           ${STUDENT_PHONE_SQL} AS origin_phone,
           pv.abbreviation AS program_name
    FROM enrollments e
    JOIN customers cust ON cust.customer_id = e.customer_id
    JOIN persons per ON per.person_id = cust.person_id
    LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    WHERE e.enrollment_id = $1
  `, [enrollmentId])

  const data = rows?.[0]
  if (!data) throw new Error('Inscripcion no encontrada')

  const fullName = `${(data.last_name || '').trim()} ${(data.first_name || '').trim()}`.trim().toUpperCase()
  // Mismo password que el flujo de cursos regulares. Es el unico que conocemos y
  // por lo tanto el unico que tenemos derecho a comunicar al alumno por correo.
  const password = '1234567'
  // createEmail UNICO \u2014 si otro alumno con apellido.nombre ya tiene ese login en
  // Odoo, buildUniqueOdooEmail agrega sufijo numerico. Sin esto, antes hacia falsa
  // reutilizacion de un user de otra persona y el correo final ni mostraba password.
  const createEmail = await buildUniqueOdooEmail(data.first_name, data.last_name, data.document_number)

  // Si la persona (mismo DNI) ya tiene un odoo_user_id propio, lo reusamos. Sino,
  // searchEmail = createEmail (que esta garantizado disponible) -> el lookup en Odoo
  // retorna null y se crea un user nuevo con password 1234567.
  const { rows: prevOdooMb } = await pool.query(`
    SELECT e.odoo_user_id FROM enrollments e
    JOIN customers c ON c.customer_id = e.customer_id
    JOIN persons p ON p.person_id = c.person_id
    WHERE p.document_number = $1 AND e.odoo_user_id IS NOT NULL
    ORDER BY e.enrollment_id DESC LIMIT 1
  `, [data.document_number])

  let searchEmail = createEmail
  if (prevOdooMb?.[0]?.odoo_user_id) {
    const existingUser = await odooClient.callKw('res.users', 'read', [
      [prevOdooMb[0].odoo_user_id], ['login']
    ]).catch(() => null)
    if (existingUser?.[0]?.login) {
      searchEmail = existingUser[0].login
    }
  }

  const result = await odooClient.enrollInAllOnlineCourses({
    searchEmail,
    createEmail,
    fullName,
    password,
    phone: data.origin_phone,
    documentNumber: data.document_number
  })

  if (result.success) {
    const odooEmailFinal = result.odoo_login || createEmail
    await pool.query(`
      UPDATE enrollments
      SET odoo_user_id = $1, odoo_email = $3, odoo_password = $4
      WHERE enrollment_id = $2
    `, [result.odoo_user_id, enrollmentId, odooEmailFinal, result.password_set || null])
  }

  // Etiqueta para el audit log: las membresias inscriben en TODOS los cursos online
  // del Campus, no a un curso especifico. Asi el detalle del audit se ve claro
  // ("Odoo user 46953 - Todos los cursos online") en vez de "- undefined".
  return { ...result, course_search: 'Todos los cursos online' }
}

async function sendMembershipEmail ({ enrollmentId }) {
  try {
    return await _sendMembershipEmailInner({ enrollmentId })
  } catch (err) {
    console.error('[sendMembershipEmail] Throw inesperado:', err.message, err.stack)
    return { success: false, error: `sendMembershipEmail: ${err.message}` }
  }
}

async function _sendMembershipEmailInner ({ enrollmentId }) {
  const queryEnrollment = () => pool.query(`
    SELECT e.enrollment_id, per.first_name, per.last_name,
           ${STUDENT_EMAIL_SQL} AS origin_email,
           pv.abbreviation AS program_name,
           pe.start_date, e.odoo_user_id, e.odoo_email, e.odoo_password,
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

  let { rows } = await queryEnrollment()
  let data = rows?.[0]
  if (!data) return { success: false, error: 'Inscripcion no encontrada' }

  const toEmail = data.origin_email
  if (!toEmail) return { success: false, error: 'Sin correo registrado' }

  // Si no tenemos odoo_user_id todavia, intentamos crear el usuario en Odoo +
  // inscribirlo en todos los cursos online ANTES de mandar el correo. Sin user
  // creado las credenciales del correo no funcionan — preferimos no mandar nada
  // a mandar credenciales falsas.
  if (!data.odoo_user_id) {
    console.log(`[sendMembershipEmail] enrollment ${enrollmentId}: sin odoo_user_id, ejecutando enrollMembershipInOdoo`)
    const odooRes = await enrollMembershipInOdoo({ enrollmentId })
    if (!odooRes?.success) {
      const errMsg = odooRes?.error || 'fallo desconocido al crear usuario en Odoo'
      console.error(`[sendMembershipEmail] No se pudo crear user en Odoo para enrollment ${enrollmentId}: ${errMsg}`)
      return {
        success: false,
        error: `No se creo usuario en Odoo (${errMsg}). El correo NO fue enviado para evitar entregar credenciales falsas.`
      }
    }
    // Refrescamos data con los campos Odoo recien guardados.
    const refreshed = await queryEnrollment()
    data = refreshed.rows?.[0] || data
  }

  // Validacion final: si despues del intento aun no hay odoo_email, abortamos.
  if (!data.odoo_email) {
    return {
      success: false,
      error: 'No se pudo determinar odoo_email tras la inscripcion. Email no enviado.'
    }
  }

  const startDate = data.start_date ? new Date(data.start_date) : new Date()
  const fechaAct = formatCalendarDate(startDate)
  const fechaRenov = formatCalendarDate(addMonthsCalendar(startDate, MEMBERSHIP_DURATION_MONTHS))

  // Solo mostramos el cronograma de pagos cuando el plan es por cuotas. Para
  // pago al contado (we_payment_way_single) el SP igual genera un installment_number=1
  // con el total, pero al alumno NO le interesa ver "1 cuota = total" — le confunde.
  let installmentsHTML = ''
  const isSinglePayment = data.payment_plan_alias === 'we_payment_way_single'
  if (!isSinglePayment) {
    const { rows: instRows } = await pool.query(`
      SELECT installment_number, amount, due_date
      FROM payment_installments WHERE enrollment_id = $1 AND installment_number > 0
      ORDER BY installment_number
    `, [enrollmentId])

    if (instRows && instRows.length > 0) {
      const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
      const fechasCells = instRows.map(i => {
        const d = new Date(i.due_date)
        return `<td><font face="Tahoma" size="2">${String(d.getUTCDate()).padStart(2,'0')} ${meses[d.getUTCMonth()]}</font></td>`
      }).join('')
      const pagosCells = instRows.map(i => `<td><font face="Tahoma" size="2">${data.currency_symbol || 'S/.'} ${Math.trunc(Number(i.amount || 0))}</font></td>`).join('')
      installmentsHTML = `
        <table width="450" border="2" align="center" style="border-collapse:collapse;text-align:center;">
          <thead><tr><td colspan="${instRows.length + 1}" style="background-color:rgb(5,36,103);color:white;"><font face="Tahoma" size="2">CRONOGRAMA DE PAGOS</font></td></tr></thead>
          <tbody>
            <tr><td style="background-color:rgb(5,36,103);color:white;"><font face="Tahoma" size="2">Fechas</font></td>${fechasCells}</tr>
            <tr><td style="background-color:rgb(5,36,103);color:white;"><font face="Tahoma" size="2">Pago</font></td>${pagosCells}</tr>
          </tbody>
        </table>`
    }
  }

  // Detectamos si es REENVIO consultando email_logs. Primer envio muestra
  // credenciales (USUARIO + 1234567). Reenvio muestra solo USUARIO + link de
  // recuperacion de password — evitamos mandar el password en multiples correos
  // (privacidad/seguridad).
  const { rows: priorSends } = await pool.query(`
    SELECT 1 FROM public.email_logs
    WHERE enrollment_id = $1 AND template_type = 'membresia' AND status = 'sent'
    LIMIT 1
  `, [enrollmentId])
  const isFirstSend = !priorSends?.[0]

  const htmlBody = buildMembresiaHTML({
    studentName: `${data.first_name} ${data.last_name}`,
    programName: data.program_name,
    email: data.odoo_email,
    password: '1234567',
    isNew: isFirstSend,
    duracion: `${MEMBERSHIP_DURATION_MONTHS} meses`,
    fechaActivacion: fechaAct,
    fechaRenovacion: fechaRenov,
    installmentsHTML,
    bloqueBeneficios: undefined,
    fichaRegistroLink: undefined
  })

  const tipo = detectMembershipType(data.program_name)
  const subject = `Bienvenido a tu Membresia ${tipo} - WE Educacion`
  // Las membresias se mandan desde pagos@we-educacion.com (mismo sender que el GAS).
  const result = await sendEmail({
    to: toEmail,
    subject,
    htmlBody,
    fromEmail: 'pagos@we-educacion.com',
    fromName: 'WE Educacion Ejecutiva'
  })

  try {
    await pool.query(`
      INSERT INTO public.email_logs (enrollment_id, to_email, subject, message_id, template_type, status)
      VALUES ($1, $2, $3, $4, 'membresia', $5)
    `, [enrollmentId, toEmail, subject, result.messageId || null, result.success ? 'sent' : 'failed'])
  } catch (logErr) { console.error('[EmailLog] Error:', logErr.message) }

  return result
}

async function changeModality ({ enrollmentId, newModalityId, justificacion, userId }) {
  const { rows: oldRows } = await pool.query(`
    SELECT e.cat_inscription_modality, c_old.description AS old_modality
    FROM enrollments e
    LEFT JOIN catalog c_old ON c_old.catalog_id = e.cat_inscription_modality
    WHERE e.enrollment_id = $1
  `, [enrollmentId])

  const old = oldRows?.[0]
  if (!old) throw new Error('Inscripcion no encontrada')

  if (old.cat_inscription_modality === newModalityId) {
    throw new Error('La modalidad seleccionada es la misma que la actual')
  }

  const { rows: newMod } = await pool.query(
    'SELECT description FROM catalog WHERE catalog_id = $1', [newModalityId]
  )

  await pool.query(
    'UPDATE enrollments SET cat_inscription_modality = $1 WHERE enrollment_id = $2',
    [newModalityId, enrollmentId]
  )

  const changes = {
    'Modalidad': {
      old: old.old_modality || '---',
      new: newMod?.[0]?.description || '---'
    }
  }

  await logAudit({
    enrollmentId,
    action: 'modality_changed',
    userId,
    justificacion,
    changes,
    details: `Cambio de modalidad: ${changes['Modalidad'].old} → ${changes['Modalidad'].new}`
  })

  return { result: 1, message: 'Modalidad actualizada correctamente' }
}

async function retireEnrollment ({ enrollmentId, reason, hasRefund, refundAmount, justificacion, userId }) {
  const { rows: oldRows } = await pool.query(`
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

  if (!oldRows?.[0]) throw new Error('Inscripcion no encontrada')

  const retId = await getCatalogIdByAlias(ALIAS.ENROLLMENT_STATUS_RETIRED)
  if (!retId) throw new Error('Catalogo de estado Retirado no encontrado')

  await pool.query(
    'UPDATE enrollments SET cat_type_status = $1 WHERE enrollment_id = $2',
    [retId, enrollmentId]
  )

  const { rows: cancelledInstallments } = await pool.query(`
    UPDATE payment_installments SET cat_status = 4456
    WHERE enrollment_id = $1 AND cat_status != 4454
    RETURNING installment_id, installment_number, amount
  `, [enrollmentId])

  const { rows: childEnrollments } = await pool.query(`
    SELECT e.enrollment_id, e.program_version_id,
           pv2.abbreviation AS child_program_name,
           pe2.global_code AS edition_code,
           to_char(pe2.start_date, 'DD/MM/YYYY') AS start_date_fmt
    FROM enrollments e
    LEFT JOIN program_versions pv2 ON pv2.program_version_id = e.program_version_id
    LEFT JOIN program_editions pe2 ON pe2.edition_num_id = e.program_edition_id
    WHERE e.parent_enrollment_id = $1 AND e.cat_type_status != $2
  `, [enrollmentId, retId])

  const retiredChildren = []
  for (const child of childEnrollments) {
    await pool.query('UPDATE enrollments SET cat_type_status = $1 WHERE enrollment_id = $2', [retId, child.enrollment_id])
    await pool.query(`DELETE FROM payment_installments WHERE enrollment_id = $1 AND cat_status != 4454`, [child.enrollment_id])
    await logAudit({
      enrollmentId: child.enrollment_id,
      action: 'retired',
      userId,
      justificacion: reason,
      details: `Retirado por retiro del programa padre #${enrollmentId} (${oldRows[0].program_name || ''} ${oldRows[0].edition_code || ''})`
    })
    retiredChildren.push(`${child.child_program_name || ''} ${child.edition_code || ''} - ${child.start_date_fmt || '---'}`.trim())
  }

  const changes = {
    'Motivo': { old: '---', new: reason || '---' },
    'Devolucion': { old: '---', new: hasRefund ? `Si - S/. ${Number(refundAmount || 0).toFixed(2)}` : 'No' }
  }
  if (cancelledInstallments.length > 0) {
    changes['Cuotas eliminadas'] = { old: '---', new: `${cancelledInstallments.length} cuota(s) pendiente(s)` }
  }
  if (retiredChildren.length > 0) {
    changes['Modulos retirados'] = { old: '---', new: retiredChildren.join(', ') }
  }

  await logAudit({
    enrollmentId,
    action: 'retired',
    userId,
    justificacion: justificacion || reason,
    changes,
    details: `Alumno retirado: ${oldRows[0].program_name || ''} ${oldRows[0].edition_code || ''}. ${hasRefund ? `Devolucion: S/. ${Number(refundAmount || 0).toFixed(2)}` : 'Sin devolucion'}${cancelledInstallments.length ? `. ${cancelledInstallments.length} cuota(s) pendiente(s) eliminada(s)` : ''}${retiredChildren.length ? `. ${retiredChildren.length} modulo(s) hijo(s) retirado(s)` : ''}`
  })

  try {
    const { rows: odooData } = await pool.query(
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
      const user = await odooClient.searchUserByEmail(od.origin_email)
      if (user?.partner_id?.[0]) {
        const groups = await odooClient.searchSlideGroup(od.odoo_activation)
        for (const g of (groups || [])) {
          await odooClient.unenrollStudentFromCourse({ partnerId: user.partner_id[0], slideGroupId: g.id })
        }
      }
      if (od.odoo_order_id) {
        await odooClient.cancelSaleOrder(od.odoo_order_id)
      }
      await logAudit({ enrollmentId, action: 'odoo_unenrolled', userId, details: `Desinscrito de Odoo por retiro` })
    }
  } catch (e) { console.error('[retireEnrollment] Error desinscribiendo Odoo:', e.message) }

  slackClient.notifyStudentRetirement({
    studentName: oldRows[0].student_name || '---',
    studentPhone: oldRows[0].student_phone || '---',
    programName: oldRows[0].program_name,
    editionCode: oldRows[0].edition_code,
    reason,
    retiredChildren
  })

  return { result: 1, message: 'Alumno retirado correctamente' }
}

async function getEnrollmentFlags ({ enrollmentId }) {
  const { rows } = await pool.query(`
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

async function editStudent ({ enrollmentId, firstName, lastName, documentNumber, originEmail, originPhone, odooEmail, newProfileId, justificacion, userId }) {
  const { rows: currentRows } = await pool.query(`
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

  const current = currentRows?.[0]
  if (!current) throw new Error('Inscripcion no encontrada')

  const changes = {}

  if (firstName !== undefined && firstName !== current.first_name) {
    changes['Nombre'] = { old: current.first_name || '---', new: firstName }
  }
  if (lastName !== undefined && lastName !== current.last_name) {
    changes['Apellido'] = { old: current.last_name || '---', new: lastName }
  }
  if (documentNumber !== undefined && documentNumber !== current.document_number) {
    changes['Documento'] = { old: current.document_number || '---', new: documentNumber }
  }
  if (originEmail !== undefined && originEmail !== current.origin_email) {
    changes['Email'] = { old: current.origin_email || '---', new: originEmail }
  }
  if (originPhone !== undefined && originPhone !== current.origin_phone) {
    changes['Telefono'] = { old: current.origin_phone || '---', new: originPhone }
  }
  if (odooEmail !== undefined && odooEmail !== (current.odoo_email || '')) {
    changes['Correo Odoo'] = { old: current.odoo_email || '---', new: odooEmail }
  }
  if (newProfileId !== undefined && newProfileId !== current.cat_profile_id) {
    const { rows: newProf } = await pool.query(
      'SELECT description FROM catalog WHERE catalog_id = $1', [newProfileId]
    )
    changes['Perfil'] = { old: current.profile_desc || '---', new: newProf?.[0]?.description || '---' }
  }

  if (Object.keys(changes).length === 0) {
    throw new Error('No se detectaron cambios')
  }

  if (changes['Nombre'] || changes['Apellido'] || changes['Documento']) {
    const updFields = []
    const updValues = []
    let idx = 1
    if (changes['Nombre'])    { updFields.push(`first_name = $${idx++}`); updValues.push(firstName) }
    if (changes['Apellido'])  { updFields.push(`last_name = $${idx++}`); updValues.push(lastName) }
    if (changes['Documento']) { updFields.push(`document_number = $${idx++}`); updValues.push(documentNumber) }
    updValues.push(current.person_id)
    await pool.query(`UPDATE persons SET ${updFields.join(', ')} WHERE person_id = $${idx}`, updValues)
  }

  if (changes['Email'] || changes['Telefono']) {
    const updFields = []
    const updValues = []
    let idx = 1
    if (changes['Email'])    { updFields.push(`origin_email = $${idx++}`); updValues.push(originEmail) }
    if (changes['Telefono']) { updFields.push(`origin_phone = $${idx++}`); updValues.push(originPhone) }
    updValues.push(current.lead_id)
    await pool.query(`UPDATE leads SET ${updFields.join(', ')} WHERE lead_id = $${idx}`, updValues)
  }

  if (changes['Perfil'] || changes['Correo Odoo']) {
    const eUpdFields = []
    const eUpdValues = []
    let eIdx = 1
    if (changes['Perfil'])      { eUpdFields.push(`cat_profile_id = $${eIdx++}`); eUpdValues.push(newProfileId) }
    if (changes['Correo Odoo']) { eUpdFields.push(`odoo_email = $${eIdx++}`); eUpdValues.push(odooEmail) }
    eUpdValues.push(enrollmentId)
    await pool.query(`UPDATE enrollments SET ${eUpdFields.join(', ')} WHERE enrollment_id = $${eIdx}`, eUpdValues)
  }

  const needsOdooSync = current.odoo_user_id && (
    changes['Nombre'] || changes['Apellido'] || changes['Documento'] ||
    changes['Telefono'] || changes['Correo Odoo']
  )
  if (needsOdooSync) {
    const finalFirst = changes['Nombre']    ? firstName      : current.first_name
    const finalLast  = changes['Apellido']  ? lastName       : current.last_name
    const fullName   = [finalFirst, finalLast].filter(Boolean).join(' ').trim()
    try {
      const res = await odooClient.updateStudentInOdoo(current.odoo_user_id, {
        name:  fullName || undefined,
        login: changes['Correo Odoo'] ? odooEmail     : undefined,
        phone: changes['Telefono']   ? originPhone   : undefined,
        vat:   changes['Documento']  ? documentNumber : undefined
      })
      if (!res.success) console.error('[editStudent] Odoo sync partial:', res.error)
    } catch (e) {
      console.error('[editStudent] Error sincronizando con Odoo:', e.message)
    }
  }

  const details = Object.entries(changes).map(([k, v]) => `${k}: ${v.old} → ${v.new}`).join(', ')

  await logAudit({
    enrollmentId,
    action: 'student_edited',
    userId,
    justificacion,
    changes,
    details
  })

  return { result: 1, message: 'Datos del alumno actualizados' }
}

async function ficoEnrollmentRegister ({ data, userId }) {
  const inscription = {
    document_number: data.document_number,
    cat_type_document: data.cat_type_document,
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    phone: data.phone,
    program_version_id: data.program_version_id,
    program_edition_id: data.program_edition_id,
    cat_insc_modality: data.cat_insc_modality,
    cat_payment_channel: data.cat_payment_channel || null,
    cat_currency: data.cat_currency,
    cat_payment_way: data.cat_payment_way,
    cat_payment_medium: data.cat_payment_medium || null,
    cat_business_entity: data.cat_business_entity || null,
    bank_account_id: data.bank_account_id || null,
    transaction_code: data.transaction_code || null,
    payment_date: data.payment_date || null,
    list_price: data.list_price || 0,
    total_amount: data.total_amount || 0,
    saved_money: data.saved_money || 0,
    is_scholarship: data.is_scholarship === true,
    cat_b2b_doctype: data.cat_b2b_doctype || null,
    seller_agent_id: data.seller_agent_id || null,
    agent_origin: data.agent_origin || null,
    client_profile: data.client_profile || null,
    observations: data.observations || 'Registro directo FICO',
    ticket_payment_urls: Array.isArray(data.ticket_payment_urls) ? data.ticket_payment_urls : [],
    installment_plan: data.installment_plan || null
  }

  const enrollRows = await callProcedureReturningRows(
    pool,
    'public.sp_fico_enrollment_register_direct',
    [userId, JSON.stringify({ inscription })],
    { statementTimeoutMs: 25000 }
  )

  const enrollResp = enrollRows?.[0] || { result: 0, message: 'Sin respuesta del SP' }

  if (enrollResp.result === 1 && enrollResp.enrollment_id) {
    const eid = enrollResp.enrollment_id

    // Persistimos email_cc en el enrollment para que reenvios futuros (resend
    // manual, cronograma actualizado, etc.) sigan copiando a los mismos
    // destinatarios sin que FICO tenga que reingresarlos cada vez.
    const ccArray = parseEmailCc(data.email_cc)
    if (ccArray.length > 0) {
      try {
        await pool.query(
          'UPDATE enrollments SET email_cc = $1 WHERE enrollment_id = $2',
          [ccArray.join(','), eid]
        )
      } catch (ccErr) {
        console.error('[ficoEnrollmentRegister] No se pudo guardar email_cc:', ccErr.message)
      }
    }

    await logAudit({ enrollmentId: eid, action: 'created', userId, details: 'Inscripcion registrada desde FICO' })
    await logAudit({
      enrollmentId: eid,
      action: 'approved',
      userId,
      details: inscription.is_scholarship ? 'Beca - sin pago requerido' : 'Auto-aprobado por registro directo FICO'
    })
    if (!inscription.is_scholarship && data.cat_payment_medium) {
      const payAmount = data.total_amount || data.saved_money || 0
      await logAudit({
        enrollmentId: eid,
        action: 'payment_registered',
        userId,
        details: `Pago registrado: ${payAmount} - Op: ${data.transaction_code || 'N/A'}`
      })
    }

    const odoo = await safeAsync('[FICO][Odoo] auto-enroll', () => enrollInOdoo({ enrollmentId: eid }))
    if (odoo?.success) {
      const cursoLabel = odoo.course_search || 'Curso no especificado'
      await logAudit({ enrollmentId: eid, action: 'odoo_enrolled', userId, details: `Odoo user ${odoo.odoo_user_id} - ${cursoLabel}` })
    }

    const emailRes = await safeAsync('[FICO][Email] auto-send', () => sendConfirmationEmail({ enrollmentId: eid }))
    if (emailRes?.success) {
      await logAudit({ enrollmentId: eid, action: 'email_sent', userId, details: `Correo confirmacion: ${emailRes.messageId}` })
    } else {
      console.error('[FICO][Email] auto-send no exitoso:', emailRes?.error || 'sin respuesta')
    }
    // Adjuntamos el estado del envio en la respuesta para que la UI pueda informar
    // si el correo de bienvenida (membresias) o confirmacion (cursos) llego.
    enrollResp.email_sent = !!emailRes?.success
    enrollResp.email_error = emailRes?.success ? null : (emailRes?.error || 'No se pudo enviar el correo')

    // Crear enrollments hijos si el programa es padre (diplomado/especializacion).
    // Para FICO directo, todavia no hay convalidaciones en BD, asi que esto inscribe
    // a TODOS los hijos del arbol de la edicion. El operador puede convalidar despues
    // desde el detalle de la inscripcion.
    await safeAsync('[FICO][Children] create', () => createChildEnrollments({ enrollmentId: eid, userId }))
  }

  return enrollResp
}

async function getAvailableEditions ({ enrollmentId }) {
  const { rows: enr } = await pool.query(
    'SELECT program_version_id, program_edition_id FROM enrollments WHERE enrollment_id = $1',
    [enrollmentId]
  )
  const e = enr?.[0]
  if (!e?.program_version_id) return []

  const editions = await callProcedureReturningRows(
    pool,
    'public.sp_edition_caller',
    [e.program_version_id, null, null, null, null, null],
    { statementTimeoutMs: 15000 }
  )

  return (editions || []).filter(ed => (ed.edition_num_id || ed.id) !== e.program_edition_id)
}

async function reprogramEdition ({ enrollmentId, newEditionId, justificacion, userId }) {
  const { rows: oldRows } = await pool.query(`
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

  const old = oldRows?.[0]
  if (!old) throw new Error('Inscripcion no encontrada')

  if (old.program_edition_id === newEditionId) {
    throw new Error('La nueva edicion es la misma que la actual')
  }

  const { rows: newRows } = await pool.query(`
    SELECT pe.edition_num_id, pe.global_code, pe.start_date, pe.program_version_id
    FROM program_editions pe
    WHERE pe.edition_num_id = $1
  `, [newEditionId])

  const newEd = newRows?.[0]
  if (!newEd) throw new Error('La edicion destino no existe')

  if (newEd.program_version_id !== old.program_version_id) {
    throw new Error('La edicion destino no pertenece al mismo programa')
  }

  await pool.query(
    'UPDATE enrollments SET program_edition_id = $1 WHERE enrollment_id = $2',
    [newEditionId, enrollmentId]
  )

  try {
    const rpCatId = await getCatalogIdByAlias(ALIAS.ENROLLMENT_STATUS_REPROGRAMMED)
    if (rpCatId) {
      await pool.query(
        'UPDATE enrollments SET cat_type_status = $1 WHERE enrollment_id = $2',
        [rpCatId, enrollmentId]
      )
    } else {
      console.warn('[reprogramEdition] No se encontro catalogo RP')
    }
  } catch (err) {
    console.error('[reprogramEdition] Error actualizando estado:', err.message)
  }

  const fmtDate = d => d ? new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '---'

  const changes = {
    'Edicion': {
      old: `${old.old_code || '---'} (${fmtDate(old.old_start_date)})`,
      new: `${newEd.global_code || '---'} (${fmtDate(newEd.start_date)})`
    }
  }

  if (old.old_start_date && newEd.start_date) {
    const oldStart = new Date(old.old_start_date)
    const newStart = new Date(newEd.start_date)
    const diffDays = Math.round((newStart - oldStart) / (1000 * 60 * 60 * 24))

    if (diffDays !== 0) {
      const { rows: updatedCuotas } = await pool.query(`
        UPDATE payment_installments
        SET due_date = due_date + INTERVAL '${diffDays} days'
        WHERE enrollment_id = $1 AND cat_status != 4454
        RETURNING installment_number, due_date
      `, [enrollmentId])

      if (updatedCuotas.length > 0) {
        changes['Cuotas reprogramadas'] = { old: '---', new: `${updatedCuotas.length} cuota(s) desplazada(s) ${diffDays > 0 ? '+' : ''}${diffDays} dias` }
      }
    }
  }

  await logAudit({
    enrollmentId,
    action: 'edition_reprogrammed',
    userId,
    justificacion,
    changes,
    details: `Reprogramacion de edicion: ${changes['Edicion'].old} → ${changes['Edicion'].new}`
  })

  if (old.odoo_activation) {
    try {
      const { rows: odooData } = await pool.query(
        `SELECT odoo_user_id, odoo_order_id FROM enrollments WHERE enrollment_id = $1`, [enrollmentId]
      ).catch(() => ({ rows: [] }))
      const od = odooData?.[0]

      if (od?.odoo_user_id) {
        const user = await odooClient.searchUserByEmail(old.origin_email)
        if (user?.partner_id?.[0]) {
          const oldGroups = await odooClient.searchSlideGroup(old.odoo_activation)
          const oldDate = new Date(old.old_start_date)
          const oldDd = String(oldDate.getDate()).padStart(2, '0')
          const oldMm = String(oldDate.getMonth() + 1).padStart(2, '0')
          const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
          const oldSearchName = `${old.odoo_activation} (${oldDd}/${oldMm}) - ${monthNames[oldDate.getMonth()]} ${oldDate.getFullYear()}`
          const oldMatch = oldGroups.find(g => g.name === oldSearchName)
          if (oldMatch) {
            await odooClient.unenrollStudentFromCourse({ partnerId: user.partner_id[0], slideGroupId: oldMatch.id })
            await logAudit({ enrollmentId, action: 'odoo_unenrolled', userId, details: `Desinscrito de Odoo: ${oldSearchName}` })
          }
        }

        if (od.odoo_order_id) {
          await odooClient.cancelSaleOrder(od.odoo_order_id)
          await pool.query('UPDATE enrollments SET odoo_order_id = NULL WHERE enrollment_id = $1', [enrollmentId])
        }
        await pool.query('UPDATE enrollments SET odoo_user_id = NULL, odoo_student_id = NULL WHERE enrollment_id = $1', [enrollmentId])
      }
    } catch (e) { console.error('[reprogramEdition] Error desinscribiendo Odoo:', e.message) }

    try {
      const odoo = await enrollInOdoo({ enrollmentId })
      if (odoo?.success) {
        await logAudit({ enrollmentId, action: 'odoo_enrolled', userId, details: `Reinscrito en Odoo con nueva edicion: ${newEd.global_code}` })
      } else {
        await logAudit({ enrollmentId, action: 'odoo_enrolled', userId, details: `Pendiente reinscripcion en Odoo para edicion: ${newEd.global_code}. ${odoo?.error || ''}` })
      }
    } catch (e) {
      console.error('[reprogramEdition] Error reinscribiendo Odoo:', e.message)
      await logAudit({ enrollmentId, action: 'odoo_enrolled', userId, details: `Error reinscripcion Odoo: ${e.message}` }).catch(() => {})
    }

    try {
      const emailRes = await sendConfirmationEmail({ enrollmentId })
      if (!emailRes?.success) {
        await logAudit({ enrollmentId, action: 'email_sent', userId, details: `Error enviando correo: ${emailRes?.error || 'desconocido'}` }).catch(() => {})
      }
    } catch (e) { console.error('[reprogramEdition] Error enviando email:', e.message) }
  }

  return { result: 1, message: 'Edicion reprogramada correctamente' }
}

async function getProgramPrice ({ programVersionId }) {
  const { rows } = await pool.query(`
    SELECT pp.price_student_soles, pp.price_student_dollars,
           pp.price_profesional_soles, pp.price_profesional_dollars,
           pp.reservation_price_soles, pp.reservation_price_dollars
    FROM program_price pp
    WHERE pp.program_version_id = $1 AND pp.active = 'Y'
    ORDER BY pp.program_price_id DESC LIMIT 1
  `, [programVersionId])
  return rows?.[0] || null
}

// Clona el lead del enrollment original para asociarlo a la nueva inscripcion del cambio de curso.
// Mantiene todos los campos originales pero apunta al nuevo programa/edicion y resetea fechas.
async function _ccCloneLeadForChange ({ enrollmentId, newProgramVersionId, newEditionId, userId }) {
  const { rows: leadCols } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'leads' AND table_schema = 'public'
      AND column_name NOT IN ('lead_id')
    ORDER BY ordinal_position
  `)
  const allCols = leadCols.map(r => r.column_name)
  const overrides = {
    program_version_id: newProgramVersionId,
    program_edition_id: newEditionId,
    pay_date: 'NOW()::DATE',
    registration_date: 'NOW()',
    modification_date: 'NOW()',
    active: "'Y'",
    user_registration_id: userId,
    user_modification_id: userId,
    enrollment_id: 'NULL'
  }
  const selectParts = allCols.map(col => {
    if (overrides[col] !== undefined) return `${overrides[col]} AS "${col}"`
    return `l."${col}"`
  })

  const { rows } = await pool.query(`
    INSERT INTO leads (${allCols.map(c => `"${c}"`).join(', ')})
    SELECT ${selectParts.join(', ')}
    FROM leads l
    WHERE l.enrollment_id = $1
    RETURNING lead_id
  `, [enrollmentId])

  const newLeadId = rows?.[0]?.lead_id
  if (!newLeadId) throw new Error('Error al crear el lead para el cambio de curso')
  return newLeadId
}

// Registra la fila en course_changes con metadata del cambio.
async function _ccRecordCourseChangeRow ({ old, newEid, newProgramVersionId, newEditionId, totalAmount, justificacion, userId, oldAmount }) {
  await pool.query(`
    INSERT INTO course_changes (
      customer_id, enrollment_origin_id, enrollment_destination_id,
      program_origin_id, program_destination_id,
      edition_origin_id, edition_destination_id,
      amount_origin, amount_destination, amount_difference,
      justificacion, approved_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `, [
    old.customer_id, old.enrollment_id, newEid,
    old.program_version_id, newProgramVersionId,
    old.program_edition_id, newEditionId,
    oldAmount, totalAmount, totalAmount - oldAmount,
    justificacion, userId
  ])
}

// Desinscribe al alumno del curso anterior en Odoo y cancela su sale order.
// Si falla cualquier paso, se loguea y continua sin bloquear el flujo principal.
async function _ccUnenrollFromOldOdoo ({ enrollmentId, old }) {
  if (!old.old_odoo_activation) return
  await safeAsync('[courseChange][Odoo] unenroll old', async () => {
    const { rows: odooData } = await pool.query(
      `SELECT odoo_user_id, odoo_order_id FROM enrollments WHERE enrollment_id = $1`, [enrollmentId]
    )
    const od = odooData?.[0]
    if (!od?.odoo_user_id) return

    const user = await odooClient.searchUserByEmail(old.origin_email)
    if (user?.partner_id?.[0]) {
      const groups = await odooClient.searchSlideGroup(old.old_odoo_activation)
      for (const g of (groups || [])) {
        await odooClient.unenrollStudentFromCourse({ partnerId: user.partner_id[0], slideGroupId: g.id })
      }
    }
    if (od.odoo_order_id) {
      await odooClient.cancelSaleOrder(od.odoo_order_id)
    }
  })
}

async function courseChange ({ enrollmentId, newProgramVersionId, newEditionId, totalAmount, justificacion, userId, cat_currency, cat_method_payment, cat_business_entity, bank_account_id, transaction_code, ticket_payment_urls }) {
  const { rows: oldRows } = await pool.query(`
    SELECT e.enrollment_id, e.program_version_id, e.program_edition_id,
           e.customer_id, e.seller_agent_id, e.cat_currency,
           e.total_amount, e.discount_amount,
           e.cat_inscription_modality, e.cat_payment_channel, e.cat_payment_plan,
           per.first_name, per.last_name, per.document_number, per.cat_type_document,
           l.lead_id, ${STUDENT_EMAIL_SQL} AS origin_email, l.cat_code_country,
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

  const old = oldRows?.[0]
  if (!old) throw new Error('Inscripcion no encontrada')

  const { rows: newEdRows } = await pool.query(`
    SELECT pe.edition_num_id, pe.global_code, pe.start_date,
           pv.abbreviation AS new_program_name, pv.program_version_id
    FROM program_editions pe
    JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
    WHERE pe.edition_num_id = $1 AND pe.program_version_id = $2
  `, [newEditionId, newProgramVersionId])

  const newEd = newEdRows?.[0]
  if (!newEd) throw new Error('La edicion destino no existe o no pertenece al programa seleccionado')

  const ccCatId = await getCatalogIdByAlias(ALIAS.ENROLLMENT_STATUS_COURSE_CHANGED)
  if (ccCatId) {
    await pool.query(
      'UPDATE enrollments SET cat_type_status = $1 WHERE enrollment_id = $2',
      [ccCatId, enrollmentId]
    )
  }

  const ccNote = `Cambio de curso desde inscripcion #${enrollmentId} (${old.old_program_name || ''} ${old.old_edition_code || ''})`

  const newLeadId = await _ccCloneLeadForChange({ enrollmentId, newProgramVersionId, newEditionId, userId })

  const ccCertCatId    = await getCatalogIdByAlias(ALIAS.CERTIFICATE_STATUS_PAID)
  const ccContadoCatId = await getCatalogIdByAlias(ALIAS.PAYMENT_WAY_SINGLE)
  const { rows: oldPayment } = await pool.query(
    `SELECT cat_method_payment FROM payments WHERE enrollment_id = $1 AND active = 'Y' ORDER BY payment_id DESC LIMIT 1`,
    [enrollmentId]
  )
  let methodPayment = oldPayment?.[0]?.cat_method_payment || null
  if (!methodPayment) {
    methodPayment = await getCatalogIdByAlias(ALIAS.PAYMENT_METHOD_TRANSFER)
  }

  const inscription = {
    lead_id: newLeadId,
    program_version_id: newProgramVersionId,
    program_edition_id: newEditionId,
    cat_insc_modality: old.cat_inscription_modality,
    cat_payment_channel: old.cat_payment_channel,
    cat_currency: old.cat_currency,
    cat_payment_way: ccContadoCatId || old.cat_payment_plan,
    cat_type_payment: ccContadoCatId || old.cat_payment_plan,
    cat_method_payment: cat_method_payment || methodPayment,
    cat_certificate_status: ccCertCatId || null,
    cat_currency: cat_currency || old.cat_currency,
    list_price: totalAmount || 0,
    total_amount: totalAmount,
    saved_money: 0,
    ticket_payment_urls: ticket_payment_urls || [],
    observations: ccNote,
    installment_plan: null,
    document: old.document_number,
    cat_type_document: old.cat_type_document,
    full_name: old.first_name,
    last_name: old.last_name,
    email: old.origin_email,
    cat_country: old.cat_code_country
  }

  const enrollRows = await callProcedureReturningRows(
    pool,
    'public.sp_comercial_enrollment_register',
    [newLeadId, userId, JSON.stringify({ inscription })],
    { statementTimeoutMs: 25000 }
  )

  const newEnroll = enrollRows?.[0] || { result: 0, message: 'Sin respuesta del SP' }
  if (newEnroll.result !== 1) {
    throw new Error(newEnroll.message || 'Error al crear la inscripcion destino')
  }

  const newEid = newEnroll.enrollment_id

  const ccCheckedCatId = await getCatalogIdByAlias(ALIAS.ENROLLMENT_STATUS_CHECKED)
  if (ccCheckedCatId && newEid) {
    await pool.query('UPDATE enrollments SET cat_fico_status = $1 WHERE enrollment_id = $2', [ccCheckedCatId, newEid])
  }

  if (newEid) {
    await pool.query(
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
      await pool.query(
        `UPDATE payments SET ${payUpdates.join(', ')} WHERE enrollment_id = $${pIdx} AND active = 'Y'`,
        payParams
      )
    }
  }

  const oldAmount = Number(old.total_amount || 0) - Number(old.discount_amount || 0)
  await _ccRecordCourseChangeRow({
    old: { ...old, enrollment_id: enrollmentId },
    newEid,
    newProgramVersionId, newEditionId,
    totalAmount, justificacion, userId,
    oldAmount
  })

  const fmtDate = d => d ? new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '---'

  const changes = {
    'Programa anterior': { old: `${old.old_program_name || '---'} - ${old.old_edition_code || '---'} (${fmtDate(old.old_start_date)})`, new: '---' },
    'Programa nuevo': { old: '---', new: `${newEd.new_program_name || '---'} - ${newEd.global_code || '---'} (${fmtDate(newEd.start_date)})` },
    'Nuevo enrollment': { old: '---', new: `#${newEid || '---'}` }
  }

  await logAudit({
    enrollmentId,
    action: 'course_changed',
    userId,
    justificacion,
    changes,
    details: `Cambio de curso: ${old.old_program_name} ${old.old_edition_code} → ${newEd.new_program_name} ${newEd.global_code}`
  })

  if (newEid) {
    await logAudit({
      enrollmentId: newEid,
      action: 'created_from_cc',
      userId,
      justificacion,
      changes: { 'Enrollment original': { old: '---', new: `#${enrollmentId} (${old.old_program_name} ${old.old_edition_code})` } },
      details: `Creado por cambio de curso desde inscripcion #${enrollmentId}`
    })
  }

  if (newEid) {
    await _ccUnenrollFromOldOdoo({ enrollmentId, old })
    if (old.old_odoo_activation) {
      await logAudit({ enrollmentId, action: 'odoo_unenrolled', userId, details: `Desinscrito de Odoo: ${old.old_odoo_activation}` })
    }

    const odoo = await safeAsync('[courseChange][Odoo] enroll new', () => enrollInOdoo({ enrollmentId: newEid }))
    if (odoo?.success) {
      await logAudit({ enrollmentId: newEid, action: 'odoo_enrolled', userId, details: `Inscrito en Odoo: user ${odoo.odoo_user_id}` })
    }

    const emailRes = await safeAsync('[courseChange][Email] send confirmation', () => sendConfirmationEmail({ enrollmentId: newEid }))
    if (emailRes?.success) {
      await logAudit({ enrollmentId: newEid, action: 'email_sent', userId, details: `Correo confirmacion CC: ${emailRes.messageId}` })
    }
  }

  return { result: 1, message: 'Cambio de curso realizado', new_enrollment_id: newEid }
}

async function getEnrollmentSnapshot (enrollmentId) {
  const { rows } = await pool.query(`
    SELECT e.total_amount, e.discount_amount, e.list_price,
           ${STUDENT_EMAIL_SQL} AS origin_email,
           ${STUDENT_PHONE_SQL} AS origin_phone,
           per.first_name, per.last_name, per.document_number,
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
  const { rows: files } = await pool.query(
    `SELECT file_name, file_url FROM enrollment_attachments WHERE enrollment_id = $1 AND active = 'Y'`,
    [enrollmentId]
  ).catch(() => ({ rows: [] }))
  return {
    alumno: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
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

async function rejectEnrollment ({ enrollmentId, reason, userId }) {
  const { rows } = await pool.query(`
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

  if (!rows?.[0]) throw new Error('Inscripcion no encontrada')
  const data = rows[0]

  const obsCatId = await getCatalogIdByAlias(ALIAS.ENROLLMENT_STATUS_OBSERVED)
  if (!obsCatId) throw new Error('Catalogo de estado Observado no encontrado')

  await pool.query(
    'UPDATE enrollments SET cat_fico_status = $1 WHERE enrollment_id = $2',
    [obsCatId, enrollmentId]
  )

  const snapshot = await getEnrollmentSnapshot(enrollmentId)

  await logAudit({
    enrollmentId,
    action: 'observed',
    userId,
    justificacion: reason,
    changes: snapshot ? { _snapshot_before: snapshot } : null,
    details: `Inscripcion observada: ${data.program_name || ''}`
  })

  if (data.seller_agent_id) {
    try {
      const title = 'Inscripcion Observada'
      const message = `La inscripcion de ${data.student_name || '---'} en ${data.program_name || '---'} fue observada: ${reason}`
      await pool.query(`
        INSERT INTO notifications (user_id, lead_id, title, message)
        VALUES ($1, $2, $3, $4)
      `, [data.seller_agent_id, data.lead_id || null, title, message])

      await pool.query(`NOTIFY canal_crm_notificaciones, '${JSON.stringify({ asesor_id: data.seller_agent_id })}'`)
    } catch (notifErr) {
      console.error('[rejectEnrollment] Error creando notificacion:', notifErr.message)
    }
  }

  try {
    const { rows: ficoUser } = await pool.query('SELECT alias FROM users WHERE user_id = $1', [userId])
    const edDate = data.edition_start_date ? new Date(data.edition_start_date).toLocaleDateString('es-PE') : ''
    await slackClient.notifyEnrollmentObserved({
      studentName: data.student_name,
      programName: data.program_name,
      editionCode: data.edition_code,
      editionDate: edDate,
      advisorName: data.advisor_alias,
      reason,
      rejectedByName: ficoUser?.[0]?.alias || `Usuario ${userId}`
    })
  } catch (slackErr) {
    console.error('[rejectEnrollment] Slack:', slackErr.message)
  }

  return { result: 1, message: 'Inscripcion observada correctamente' }
}

async function resubmitEnrollment ({ enrollmentId, userId }) {
  const obsCatId = await getCatalogIdByAlias(ALIAS.ENROLLMENT_STATUS_OBSERVED)
  if (!obsCatId) throw new Error('Catalogo de estado Observado no encontrado')

  const { rows: chk } = await pool.query(
    'SELECT cat_fico_status, seller_agent_id FROM enrollments WHERE enrollment_id = $1',
    [enrollmentId]
  )
  if (!chk?.[0]) throw new Error('Inscripcion no encontrada')
  if (chk[0].cat_fico_status !== obsCatId) throw new Error('La inscripcion no esta en estado Observado')

  const snapshotAfter = await getEnrollmentSnapshot(enrollmentId)

  const { rows: prevAudit } = await pool.query(`
    SELECT changes FROM enrollment_audit_log
    WHERE enrollment_id = $1 AND action = 'observed'
    ORDER BY performed_at DESC LIMIT 1
  `, [enrollmentId])

  let diffChanges = {}
  const prevSnapshot = prevAudit?.[0]?.changes
  if (prevSnapshot && snapshotAfter) {
    const before = typeof prevSnapshot === 'string' ? JSON.parse(prevSnapshot) : prevSnapshot
    const beforeData = before._snapshot_before || before
    for (const key of Object.keys(snapshotAfter)) {
      const oldVal = String(beforeData[key] || '---')
      const newVal = String(snapshotAfter[key] || '---')
      if (oldVal !== newVal) {
        diffChanges[key] = { old: oldVal, new: newVal }
      }
    }
  }

  const hasDiff = Object.keys(diffChanges).length > 0

  await pool.query(
    'UPDATE enrollments SET cat_fico_status = NULL WHERE enrollment_id = $1',
    [enrollmentId]
  )

  const allChanges = {}
  if (snapshotAfter && prevSnapshot) {
    const before = typeof prevSnapshot === 'string' ? JSON.parse(prevSnapshot) : prevSnapshot
    const beforeData = before._snapshot_before || before
    for (const key of Object.keys(snapshotAfter)) {
      allChanges[key] = { old: String(beforeData[key] || '---'), new: String(snapshotAfter[key] || '---') }
    }
  }

  await logAudit({
    enrollmentId,
    action: 'resubmitted',
    userId,
    changes: Object.keys(allChanges).length ? allChanges : null,
    details: hasDiff ? `Reenviado con ${Object.keys(diffChanges).length} campo(s) modificado(s)` : 'Inscripcion reenviada a FICO para revision'
  })

  try {
    const { rows: enrollData } = await pool.query(`
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
    const ed = enrollData?.[0]
    if (ed) {
      const edDate = ed.edition_start_date ? new Date(ed.edition_start_date).toLocaleDateString('es-PE') : ''
      await slackClient.notifyEnrollmentResubmitted({
        studentName: ed.student_name,
        programName: ed.program_name,
        editionCode: ed.edition_code,
        editionDate: edDate,
        advisorName: ed.advisor_alias
      })
    }
  } catch (slackErr) {
    console.error('[resubmitEnrollment] Slack:', slackErr.message)
  }

  return { result: 1, message: 'Inscripcion reenviada correctamente' }
}

async function getValidations ({ enrollmentId }) {
  const { rows } = await pool.query(`
    SELECT ev.*, pv.abbreviation as child_name
    FROM enrollment_validations ev
    JOIN program_versions pv ON pv.program_version_id = ev.child_version_id
    WHERE ev.enrollment_id = $1
    ORDER BY ev.validation_id
  `, [enrollmentId])
  return rows
}

async function saveValidations ({ enrollmentId, validations, userId }) {
  await pool.query('DELETE FROM enrollment_validations WHERE enrollment_id = $1', [enrollmentId])
  for (const v of validations) {
    await pool.query(`
      INSERT INTO enrollment_validations (enrollment_id, child_version_id, validation_type, custom_edition_id, notes, status, requested_by)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6)
    `, [enrollmentId, v.child_version_id, v.validation_type || 'same_edition', v.custom_edition_id || null, v.notes || null, userId])
  }

  await logAudit({
    enrollmentId,
    action: 'validation_requested',
    userId,
    details: `Convalidacion solicitada: ${validations.length} modulo(s) convalidado(s)`
  })

  return { result: 1, message: 'Convalidaciones guardadas' }
}

/**
 * Devuelve los modulos hijos de un program_version, con sus ediciones disponibles.
 * Si se pasa parentEditionId, calcula tambien `tree_edition_id` para cada hijo:
 * la edicion default que el arbol del padre asigna. Si null = el hijo NO esta
 * programado en esa edicion del padre y el operador debe elegir manualmente.
 */
async function getProgramChildren ({ programVersionId, parentEditionId = null }) {
  const { rows } = await pool.query(`
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

  if (!parentEditionId || !rows?.length) return rows

  // Calcular tree_edition_id por hijo a partir del arbol del padre.
  const treeRows = await callProcedureReturningRows(pool, 'public.sp_edition_tree_get', [parentEditionId], { statementTimeoutMs: 15000 }).catch(() => [])
  const treeChildren = treeRows?.[0]?.children || []
  const treeMap = {}
  for (const ch of treeChildren) {
    if (ch.child_program_version_id) {
      treeMap[ch.child_program_version_id] = ch.edition_id || ch.edition_num_id || null
    }
  }
  return rows.map(r => ({
    ...r,
    tree_edition_id: treeMap[r.child_program_version_id] || null,
    is_in_parent_tree: !!treeMap[r.child_program_version_id]
  }))
}

async function rescheduleInstallments ({ enrollmentId, changes, justificacion, reasonCode, userId }) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error('Debe especificar al menos una cuota a reprogramar')
  }
  if (!justificacion || !justificacion.trim()) {
    throw new Error('La justificacion es obligatoria')
  }

  const { rows: enrollRows } = await pool.query(`
    SELECT e.enrollment_id, e.odoo_order_id, pe.end_date AS edition_end_date, pe.global_code
    FROM enrollments e
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    WHERE e.enrollment_id = $1
  `, [enrollmentId])
  const enrollment = enrollRows?.[0]
  if (!enrollment) throw new Error('Inscripcion no encontrada')

  const installmentIds = changes.map(c => Number(c.installment_id)).filter(Boolean)
  const { rows: currentInst } = await pool.query(`
    SELECT installment_id, installment_number, due_date, amount, cat_status
    FROM payment_installments
    WHERE enrollment_id = $1 AND installment_id = ANY($2::int[])
  `, [enrollmentId, installmentIds])

  const byId = new Map()
  for (const i of currentInst) byId.set(Number(i.installment_id), i)

  const editionEnd = enrollment.edition_end_date ? new Date(enrollment.edition_end_date) : null
  const normalizedChanges = []
  const auditDiff = {}

  for (const raw of changes) {
    const id = Number(raw.installment_id)
    const inst = byId.get(id)
    if (!inst) throw new Error(`Cuota ${id} no pertenece a la inscripcion`)
    if (inst.installment_number === 0) throw new Error('El pago inicial no se reprograma')
    if (inst.cat_status === 4454) throw new Error(`La cuota ${inst.installment_number} ya esta pagada`)

    const newDate = new Date(raw.new_due_date)
    if (isNaN(newDate.getTime())) throw new Error(`Fecha invalida para cuota ${inst.installment_number}`)

    const oldDate = new Date(inst.due_date)
    newDate.setHours(0, 0, 0, 0)
    oldDate.setHours(0, 0, 0, 0)

    if (newDate <= oldDate) {
      throw new Error(`La nueva fecha de la cuota ${inst.installment_number} debe ser posterior a la actual (${oldDate.toISOString().slice(0, 10)})`)
    }
    if (editionEnd) {
      const endCopy = new Date(editionEnd); endCopy.setHours(0, 0, 0, 0)
      if (newDate > endCopy) {
        throw new Error(`La cuota ${inst.installment_number} no puede superar la fecha fin de la edicion (${endCopy.toISOString().slice(0, 10)})`)
      }
    }

    normalizedChanges.push({
      installment_id: id,
      installment_number: inst.installment_number,
      old_due_date: oldDate.toISOString().slice(0, 10),
      new_due_date: newDate.toISOString().slice(0, 10)
    })
    auditDiff[`Cuota ${inst.installment_number}`] = {
      old: oldDate.toISOString().slice(0, 10),
      new: newDate.toISOString().slice(0, 10)
    }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const ch of normalizedChanges) {
      await client.query(
        'UPDATE payment_installments SET due_date = $1 WHERE installment_id = $2 AND enrollment_id = $3',
        [ch.new_due_date, ch.installment_id, enrollmentId]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  let odooResult = { success: true, updated: 0, skipped: true }
  if (enrollment.odoo_order_id) {
    try {
      odooResult = await odooClient.updateFeeDueDates({
        orderId: enrollment.odoo_order_id,
        changes: normalizedChanges.map(c => ({ seq: c.installment_number, new_due_date: c.new_due_date }))
      })
      console.log('[rescheduleInstallments] Odoo result:', JSON.stringify(odooResult))
    } catch (err) {
      console.error('[rescheduleInstallments] Odoo sync exception:', err.message, err.stack)
      odooResult = { success: false, error: err.message }
    }
  } else {
    console.log('[rescheduleInstallments] Sin odoo_order_id, sync omitido')
  }

  const reasonLabels = { financiero: 'Financiero', academico: 'Academico', personal: 'Personal', otro: 'Otro' }
  const reasonLabel = reasonLabels[reasonCode] || 'Otro'

  let odooErrorSummary = null
  if (odooResult?.success === false) {
    if (odooResult.error) {
      odooErrorSummary = odooResult.error
    } else if (odooResult.failed?.length) {
      odooErrorSummary = odooResult.failed
        .map(f => `Cuota ${f.seq}: ${f.error}`)
        .join('; ')
    } else {
      odooErrorSummary = 'Error desconocido'
    }
  }

  const odooNote = odooResult?.success === false
    ? ` | Odoo: FALLO (${odooErrorSummary})`
    : (enrollment.odoo_order_id ? ' | Odoo: sincronizado' : ' | Odoo: sin orden asociada')
  const details = `Motivo: ${reasonLabel} — ${normalizedChanges.length} cuota(s) reprogramada(s)${odooNote}`

  await logAudit({
    enrollmentId,
    action: 'installments_rescheduled',
    userId,
    justificacion: justificacion.trim(),
    changes: auditDiff,
    details
  })

  return {
    result: 1,
    message: 'Cuotas reprogramadas correctamente',
    updated: normalizedChanges.length,
    odoo_sync: odooResult?.success !== false,
    odoo_error: odooErrorSummary,
    odoo_failed_fees: odooResult?.failed || [],
    odoo_skipped: !!odooResult?.skipped
  }
}

export default {
  enrollmentList,
  paymentDetailGet,
  confirmPayment,
  bankAccountList,
  enrollInOdoo,
  sendConfirmationEmail,
  sendPaymentConfirmationEmail,
  getEmailLogs,
  ficoEnrollmentRegister,
  logAudit,
  getAuditLog,
  enrollmentUpdate,
  reprogramEdition,
  getAvailableEditions,
  courseChange,
  changeModality,
  editStudent,
  confirmInstallment,
  previewConfirmationEmail,
  retireEnrollment,
  rejectEnrollment,
  resubmitEnrollment,
  getEnrollmentFlags,
  getProgramPrice,
  enrollMembershipInOdoo,
  sendMembershipEmail,
  syncInstallmentPaymentToOdoo,
  getValidations,
  saveValidations,
  getProgramChildren,
  rescheduleInstallments,
  validateChildEnrollmentSetup
}
