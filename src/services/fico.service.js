import { pool, withTransaction } from '../config/db.js'
import { callProcedureReturningRows } from '../utils/spHelper.js'
import { ALIAS } from '../utils/catalog-aliases.js'
import { getCatalogIdByAlias } from '../utils/catalog-helper.js'
import { safeAsync } from '../utils/safe-async.js'
import { STUDENT_EMAIL_SQL, STUDENT_PHONE_SQL } from '../utils/student-contacts.sql.js'
import { parseEmailCc } from '../utils/email-cc.js'
import {
  MEMBERSHIP_DURATION_MONTHS,
  formatCalendarDate,
  addMonthsCalendar,
  isMembership
} from '../utils/fico-formatters.js'
import {
  generatePassword,
  buildOdooEmailBase,
  buildUniqueOdooEmail
} from '../utils/fico-odoo.helper.js'
import {
  getEnrollmentOdoo,
  getEnrollmentProgramIds,
  getProgramPrice as queryProgramPrice
} from '../utils/fico-queries.sql.js'
import odooClient from '../config/odooClient.js'
import { sendEmail, sendFicoEmail } from '../config/zeptomail.js'
import { buildConfirmacionHTML } from '../templates/confirmacion-inscripcion.js'
import { buildConfirmacionOnlineHTML } from '../templates/confirmacion-online.js'
import { buildConfirmacionPagoHTML } from '../templates/confirmacion-pago.js'
import { buildMembresiaHTML, detectMembershipType } from '../templates/bienvenida-membresia.js'
import { generateCronogramaPdf } from './pdf.service.js'
import slackClient from '../config/slack.js'
import { refreshEnrollmentMv } from './fico-mv-refresh.cron.js'
import { enqueue as enqueueJob } from './job-queue.service.js'

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

// KPIs diarios (hoy vs ayer) usados por el header del modulo FICO.
// Reemplaza el patron previo de llamar a enrollmentList(size=200) x2 — que
// reusaba el SP del listado (5-7s c/u) solo para contar y sumar. Esta funcion
// agrega con COUNT FILTER + SUM en una sola query (~250ms en prod).
//
// _today y _yesterday deben venir como DATE en zona Lima (el frontend ya las
// calcula con la misma logica). El SP de BD asume registration_date en TZ del
// servidor y filtra por rango [_yesterday, _today + 1 day).
async function getKpisDaily ({ today, yesterday }) {
  if (!today || !yesterday) {
    throw new Error('getKpisDaily requiere today y yesterday en formato YYYY-MM-DD')
  }
  const { rows } = await pool.query(
    'SELECT day_label, total, confirmed, pending, amount FROM public.sp_fico_kpis_daily($1::date, $2::date)',
    [today, yesterday]
  )
  // Aplanar a { today: {...}, yesterday: {...} } para que el frontend no tenga
  // que rebuscar por day_label.
  const out = { today: null, yesterday: null }
  for (const r of rows) {
    const bucket = {
      total: Number(r.total),
      confirmed: Number(r.confirmed),
      pending: Number(r.pending),
      amount: Number(r.amount)
    }
    if (r.day_label === 'today') out.today = bucket
    else if (r.day_label === 'yesterday') out.yesterday = bucket
  }
  return out
}

// Lista distinta de "Asesor" tal y como aparece en la columna del listado FICO.
// Replica la misma expresion CASE WHEN que arma sp_fico_enrollment_list para
// `seller_agent_name`, de modo que el dropdown del filtro Asesor matchee
// exactamente los strings que el SP usa para comparar el array `advisors`.
// Incluye canales (B2B, WEB, SA), asesores solos (AE30) y combinaciones
// (B2B - AE30, WEB - AE30). Scope: solo inscripciones activas.
//
// Cache in-memory con TTL 5 min: la lista cambia solo cuando se crea/edita una
// inscripcion con un asesor nuevo (raro). Invalidar con invalidateAdvisorsCache()
// desde flujos que muten enrollments.seller_agent_id.
const ADVISORS_TTL_MS = 5 * 60 * 1000
let _advisorsCache = null
let _advisorsCachedAt = 0

function invalidateAdvisorsCache () {
  _advisorsCache = null
  _advisorsCachedAt = 0
}

async function enrollmentAdvisorsList () {
  const now = Date.now()
  if (_advisorsCache && (now - _advisorsCachedAt) < ADVISORS_TTL_MS) {
    return _advisorsCache
  }
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
  const { rows } = await pool.query(sql)
  _advisorsCache = rows.map(r => r.seller_agent_name).filter(Boolean)
  _advisorsCachedAt = now
  return _advisorsCache
}


// Cobranzas: cuotas pendientes de inscripciones aprobadas que vencen en el mes
// indicado. Excluye el inicial (installment_number = 0) — en aprobada el inicial
// ya esta pagado por definicion. Devuelve items + KPIs aggregadas del mes.
async function getCollections ({ year, month, day, q, state, advisorIds }) {
  const yearN = Number(year)
  const monthN = Number(month)
  if (!Number.isInteger(yearN) || yearN < 2020 || yearN > 2100) throw new Error('year invalido')
  if (!Number.isInteger(monthN) || monthN < 1 || monthN > 12) throw new Error('month invalido')

  // day es opcional: null = todo el mes, 1-31 = solo ese dia.
  // No validamos contra dias-en-mes porque si el cliente pasa 31 en Feb,
  // Postgres rechaza make_date y el error es claro.
  let dayN = null
  if (day !== undefined && day !== null && day !== '') {
    dayN = Number(day)
    if (!Number.isInteger(dayN) || dayN < 1 || dayN > 31) throw new Error('day invalido')
  }

  const search = (q || '').trim() || null
  const stateFilter = ['overdue', 'today', 'upcoming'].includes(state) ? state : 'all'
  const advisorIdsArr = Array.isArray(advisorIds) ? advisorIds.filter(n => Number.isInteger(Number(n))) : []
  const advisorJson = JSON.stringify(advisorIdsArr.map(Number))

  // Query unica que trae todas las cuotas pendientes del mes seleccionado.
  // Usamos un CTE para los aliases de "cuota saldada / cancelada" — el sistema
  // maneja dos namespaces (legacy we_inst_* y nuevo we_payment_status_*),
  // ambos validos como "ya no se cobra esta cuota".
  // today_lima fija la nocion de "hoy" en zona Lima — independiente del TZ del
  // servidor de produccion (que puede correr en UTC y desfasar el filtro Hoy).
  const sql = `
    WITH paid_aliases AS (
      SELECT catalog_id FROM public."catalog"
       WHERE alias IN ('we_inst_paid', 'we_payment_status_paid', 'we_inst_cancelled')
    ),
    today_lima AS (
      SELECT (NOW() AT TIME ZONE 'America/Lima')::date AS d
    ),
    bounds AS (
      SELECT
        CASE WHEN $6::int IS NULL THEN make_date($1::int, $2::int, 1)
             ELSE make_date($1::int, $2::int, $6::int)
        END AS from_date,
        CASE WHEN $6::int IS NULL THEN (make_date($1::int, $2::int, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date
             ELSE make_date($1::int, $2::int, $6::int)
        END AS to_date
    )
    SELECT
      pi.installment_id,
      pi.installment_number,
      pi.amount::numeric                       AS amount,
      pi.due_date,
      (pi.due_date - tl.d)                     AS days_to_due,
      CASE
        WHEN pi.due_date < tl.d THEN 'overdue'
        WHEN pi.due_date = tl.d THEN 'today'
        ELSE 'upcoming'
      END                                      AS state_label,
      e.enrollment_id,
      TRIM(per.first_name || ' ' || COALESCE(per.last_name, '')) AS student_full_name,
      per.document_number,
      COALESCE(
        l.origin_email,
        (SELECT pc.value FROM public.person_contacts pc
           JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact
          WHERE pc.person_id = per.person_id AND c.alias = 'we_way_contact_email' AND pc.active='Y'
          ORDER BY pc.registration_date DESC LIMIT 1)
      ) AS email,
      COALESCE(
        l.origin_phone,
        (SELECT pc.value FROM public.person_contacts pc
           JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact
          WHERE pc.person_id = per.person_id AND c.alias = 'we_way_contact_phone' AND pc.active='Y'
          ORDER BY pc.registration_date DESC LIMIT 1)
      ) AS phone,
      pv.abbreviation AS program_name,
      pe.global_code  AS edition_code,
      e.agent_origin,
      u.alias         AS seller_agent_alias,
      CASE
        WHEN e.agent_origin IS NOT NULL AND u.alias IS NOT NULL THEN e.agent_origin || ' - ' || u.alias
        WHEN e.agent_origin IS NOT NULL THEN e.agent_origin
        ELSE u.alias
      END AS seller_agent_name
    FROM public.payment_installments pi
    JOIN public.enrollments e ON e.enrollment_id = pi.enrollment_id
    JOIN public.customers cust ON cust.customer_id = e.customer_id
    JOIN public.persons per   ON per.person_id   = cust.person_id
    JOIN public."catalog" cf  ON cf.catalog_id   = e.cat_fico_status
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.users u  ON u.user_id = e.seller_agent_id
    LEFT JOIN public.leads l  ON l.enrollment_id = e.enrollment_id
    JOIN bounds b ON TRUE
    JOIN today_lima tl ON TRUE
    WHERE
      cf.alias = 'we_enrollment_status_checked'
      AND e.active = 'Y'
      AND pi.installment_number > 0
      AND pi.cat_status NOT IN (SELECT catalog_id FROM paid_aliases)
      AND pi.due_date BETWEEN b.from_date AND b.to_date
      AND ($3::text IS NULL OR (
        per.first_name      ILIKE '%' || $3 || '%' OR
        per.last_name       ILIKE '%' || $3 || '%' OR
        per.document_number ILIKE '%' || $3 || '%' OR
        l.origin_email      ILIKE '%' || $3 || '%'
      ))
      AND (
        $4::text = 'all'
        OR ($4::text = 'overdue'  AND pi.due_date < tl.d)
        OR ($4::text = 'today'    AND pi.due_date = tl.d)
        OR ($4::text = 'upcoming' AND pi.due_date > tl.d)
      )
      AND (
        jsonb_array_length($5::jsonb) = 0
        OR e.seller_agent_id IN (SELECT (value)::int FROM jsonb_array_elements_text($5::jsonb))
      )
    ORDER BY pi.due_date ASC, e.enrollment_id ASC, pi.installment_number ASC
  `

  const { rows } = await pool.query(sql, [yearN, monthN, search, stateFilter, advisorJson, dayN])

  // KPIs siempre del MES (independientes de q/state/asesor) — el usuario ve el
  // panorama del mes mientras filtra la tabla. today_lima ancla "hoy" a Lima
  // para que el conteo de Vencidas/Hoy/Por vencer no dependa del TZ del host.
  const kpiSql = `
    WITH paid_aliases AS (
      SELECT catalog_id FROM public."catalog"
       WHERE alias IN ('we_inst_paid', 'we_payment_status_paid', 'we_inst_cancelled')
    ),
    today_lima AS (
      SELECT (NOW() AT TIME ZONE 'America/Lima')::date AS d
    ),
    bounds AS (
      SELECT
        make_date($1::int, $2::int, 1)                                              AS from_date,
        (make_date($1::int, $2::int, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date AS to_date
    ),
    rows_month AS (
      SELECT pi.amount::numeric AS amount, pi.due_date
        FROM public.payment_installments pi
        JOIN public.enrollments e ON e.enrollment_id = pi.enrollment_id
        JOIN public."catalog" cf  ON cf.catalog_id   = e.cat_fico_status
        JOIN bounds b ON TRUE
       WHERE cf.alias = 'we_enrollment_status_checked'
         AND e.active = 'Y'
         AND pi.installment_number > 0
         AND pi.cat_status NOT IN (SELECT catalog_id FROM paid_aliases)
         AND pi.due_date BETWEEN b.from_date AND b.to_date
    )
    SELECT
      COUNT(*)::int                                                            AS total_count,
      COALESCE(SUM(amount), 0)::numeric                                        AS total_amount,
      COUNT(*) FILTER (WHERE due_date < (SELECT d FROM today_lima))::int                     AS overdue_count,
      COALESCE(SUM(amount) FILTER (WHERE due_date < (SELECT d FROM today_lima)), 0)::numeric AS overdue_amount,
      COUNT(*) FILTER (WHERE due_date = (SELECT d FROM today_lima))::int                     AS today_count,
      COALESCE(SUM(amount) FILTER (WHERE due_date = (SELECT d FROM today_lima)), 0)::numeric AS today_amount,
      COUNT(*) FILTER (WHERE due_date > (SELECT d FROM today_lima))::int                     AS upcoming_count,
      COALESCE(SUM(amount) FILTER (WHERE due_date > (SELECT d FROM today_lima)), 0)::numeric AS upcoming_amount
      FROM rows_month
  `
  const { rows: kpiRows } = await pool.query(kpiSql, [yearN, monthN])
  const kpis = kpiRows[0] || {
    total_count: 0, total_amount: 0,
    overdue_count: 0, overdue_amount: 0,
    today_count: 0, today_amount: 0,
    upcoming_count: 0, upcoming_amount: 0
  }

  return { items: rows, kpis }
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


// Si la inscripcion es padre con hijos, todos los hijos no convalidados deben
// tener una edicion asignable (en el arbol del padre o custom) antes de
// confirmar el pago. Devuelve una respuesta de error (result=2) si falta algo
// o null si la validacion paso (o no aplica por no tener hijos).
async function _confirmPaymentValidateChildren (enrollmentId) {
  if (!enrollmentId) return null
  try {
    const validation = await validateChildEnrollmentSetup({ enrollmentId })
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
  return null
}

// Guard de idempotencia: si la cuota objetivo del action ya esta en estado
// 'paid' (cualquier alias), retorna exito idempotente sin tocar payments ni
// efectos posteriores. Cubre re-click de FICO o concurrencia de ventanas.
async function _confirmPaymentIdempotencyGuard (enrollmentId, action) {
  if (!enrollmentId || !['confirm_contado', 'confirm_plan'].includes(action)) return null

  // confirm_contado paga en una sola cuota (installment_number=1).
  // confirm_plan paga la cuota inicial / reserva (installment_number=0).
  const targetInstNum = action === 'confirm_contado' ? 1 : 0
  try {
    const { rows: chk } = await pool.query(`
      SELECT c.alias AS status_alias
        FROM payment_installments pi
        LEFT JOIN catalog c ON c.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = $1 AND pi.installment_number = $2
       LIMIT 1
    `, [enrollmentId, targetInstNum])
    const alreadyPaid = chk?.[0] && ['we_inst_paid', 'we_payment_status_paid'].includes(chk[0].status_alias)
    if (alreadyPaid) {
      console.warn(`[confirmPayment] Idempotente: enrollment=${enrollmentId} action=${action} ya estaba confirmado`)
      return {
        result: 1,
        message: 'El pago ya fue confirmado previamente',
        already_confirmed: true
      }
    }
  } catch (chkErr) {
    console.error('[confirmPayment] Error chequeando idempotencia:', chkErr.message)
    // Si el chequeo falla por algo raro, dejamos que el SP corra (comportamiento previo).
  }
  return null
}

async function confirmPayment (payload) {
  const childErr = await _confirmPaymentValidateChildren(payload.enrollment_id)
  if (childErr) return childErr

  const idemHit = await _confirmPaymentIdempotencyGuard(payload.enrollment_id, payload.action)
  if (idemHit) return idemHit

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
      let odooOrderId = (await getEnrollmentOdoo(payload.enrollment_id))?.odoo_order_id

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
          odooOrderId = (await getEnrollmentOdoo(payload.enrollment_id))?.odoo_order_id
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
      // Los hijos SEG nunca llevan vendedor: agent_origin='SA', seller_agent_id=NULL.
      // FICO no vende — confirma. Heredar seller_agent_id del padre contaminaria el
      // listado si el padre tuviera (por bug aguas arriba) un usuario FICO asignado,
      // y aun en el caso sano el negocio quiere que los modulos de seguimiento
      // figuren como "Sin Asesor" para no inflar comisiones por venta del padre.
      const { rows: newEnroll } = await pool.query(`
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
        parent.customer_id, childPvId, editionId,
        enrollmentId,
        parent.cat_currency, parent.cat_inscription_modality, parent.cat_payment_channel, contadoCatId || parent.cat_payment_plan,
        checkedCatId || null, segCatId || null, certCatId || null,
        userId || 9,
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

// Pre-chequea si el enrollment ya esta en Odoo (idempotencia) o si es de
// membresia (otro flujo). Devuelve `{ skip: true, result }` para hacer early
// return desde enrollInOdoo, o `null` cuando hay que continuar con el sync.
async function _enrollInOdooPreCheck (enrollmentId) {
  const { rows: chk } = await pool.query(`
    SELECT pv.abbreviation, prog.is_membership,
           e.odoo_order_id, e.odoo_user_id, e.odoo_student_id, e.odoo_email
    FROM enrollments e
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN programs prog ON prog.program_id = pv.program_id
    WHERE e.enrollment_id = $1
  `, [enrollmentId])

  if (chk?.[0] && isMembership(chk[0].abbreviation, chk[0].is_membership)) {
    return { skip: true, result: await enrollMembershipInOdoo({ enrollmentId }) }
  }
  if (chk?.[0]?.odoo_order_id) {
    console.log(`[enrollInOdoo] Skip — enrollment ${enrollmentId} ya tiene odoo_order_id=${chk[0].odoo_order_id}`)
    return {
      skip: true,
      result: {
        success: true,
        skipped: true,
        odoo_user_id: chk[0].odoo_user_id,
        odoo_student_id: chk[0].odoo_student_id,
        odoo_email: chk[0].odoo_email,
        order_id: chk[0].odoo_order_id
      }
    }
  }
  return null
}

// Crea la sale order Odoo con las cuotas planificadas y activa los fees.
// Se ejecuta despues del sync del usuario. Si falla la creacion de la orden,
// loguea pero no revierte el sync — el alumno queda en Odoo, solo le falta
// la cobranza, que FICO puede crear manualmente.
async function _createOdooOrderAndActivate ({ enrollmentId, result, odooActivation, slideGroupId, createEmail }) {
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

  const preCheck = await _enrollInOdooPreCheck(enrollmentId)
  if (preCheck) return preCheck.result

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

    await _createOdooOrderAndActivate({ enrollmentId, result, odooActivation, slideGroupId, createEmail })

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

async function previewConfirmationEmail ({ enrollmentId, overrideEditionId = null }) {
  // Si es membresia, derivar al preview de membresia (otra plantilla, otros datos).
  const { rows: checkRows } = await pool.query(`
    SELECT pv.abbreviation, prog.is_membership FROM enrollments e
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN programs prog ON prog.program_id = pv.program_id
    WHERE e.enrollment_id = $1
  `, [enrollmentId])
  if (checkRows?.[0] && isMembership(checkRows[0].abbreviation, checkRows[0].is_membership)) {
    return previewMembershipEmail({ enrollmentId, overrideEditionId })
  }

  // overrideEditionId proyecta el preview sobre una edicion futura (reprogramacion / cambio de curso)
  // antes de comprometer el cambio en BD. start_date, whatsapp_link y schedule se leen de la edicion
  // destino; el resto de datos (alumno, plan de pago, banner) sigue dependiendo del enrollment.
  const editionId = overrideEditionId || null
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
    LEFT JOIN program_editions pe ON pe.edition_num_id = COALESCE($2::integer, e.program_edition_id)
    LEFT JOIN catalog curr ON e.cat_currency = curr.catalog_id
    LEFT JOIN catalog c_plan ON c_plan.catalog_id = e.cat_payment_plan
    WHERE e.enrollment_id = $1
  `, [enrollmentId, editionId])

  const data = rows?.[0]
  if (!data) return { html: null, error: 'Inscripcion no encontrada' }

  const onlineModalityIdPreview = await getCatalogIdByAlias(ALIAS.MODALITY_ONLINE)
  const isOnlinePreview = data.cat_model_modality === onlineModalityIdPreview

  const { rows: schedRows } = await pool.query(`
    SELECT c.description AS day_name, es.start_time, es.end_time
    FROM edition_schedules es
    LEFT JOIN catalog c ON es.cat_day_id = c.catalog_id
    WHERE es.edition_num_id = COALESCE($2::integer, (SELECT program_edition_id FROM enrollments WHERE enrollment_id = $1))
    ORDER BY es.schedule_id
  `, [enrollmentId, editionId])

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

async function previewMembershipEmail ({ enrollmentId, overrideEditionId = null }) {
  const editionId = overrideEditionId || null
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
    LEFT JOIN program_editions pe ON pe.edition_num_id = COALESCE($2::integer, e.program_edition_id)
    LEFT JOIN catalog curr ON e.cat_currency = curr.catalog_id
    LEFT JOIN catalog c_plan ON c_plan.catalog_id = e.cat_payment_plan
    WHERE e.enrollment_id = $1
  `, [enrollmentId, editionId])

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

// Resuelve si el correo de confirmacion debe ir como "alumno nuevo" (con
// credenciales 1234567) o como "alumno antiguo" (con bloque "recupera tu
// password"). Combina dos senales: si ya hubo un envio previo exitoso, y si
// el alumno tiene un odoo_user_id en otro enrollment (o si el odoo_email es
// su correo personal, no el sintetico del dominio interno).
async function _resolveConfirmationEmailMode ({ enrollmentId, odooEmail }) {
  const { rows: priorSends } = await pool.query(`
    SELECT 1 FROM public.email_logs
    WHERE enrollment_id = $1 AND template_type = 'confirmacion' AND status = 'sent'
    LIMIT 1
  `, [enrollmentId])
  const isFirstSend = !priorSends?.[0]

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

  return { isFirstSend, isReturningStudent, isNew }
}

// Genera el PDF de cronograma para inscripciones de programa padre (ESP/PEE/
// Diplomado) en modalidad no-online. Devuelve `{ attachments: [...] }` en
// exito o `{ error: '...' }` si el PDF fallo o salio vacio. El caller debe
// abortar el envio en caso de error: preferimos no entregar al alumno un
// correo de padre sin su cronograma adjunto.
async function _buildCronogramaAttachment ({ enrollmentId, programName }) {
  let pdfBuffer
  try {
    pdfBuffer = await generateCronogramaPdf({ enrollmentId })
  } catch (pdfErr) {
    console.error(`[sendConfirmationEmail] Error generando PDF cronograma para enrollment #${enrollmentId}:`, pdfErr.message, pdfErr.stack)
    return { error: `No se pudo generar el PDF de cronograma (${pdfErr.message}). El correo NO fue enviado para evitar entregar al alumno un correo de programa padre sin su cronograma adjunto.` }
  }
  if (!pdfBuffer || pdfBuffer.length === 0) {
    console.error(`[sendConfirmationEmail] PDF cronograma vacio para enrollment #${enrollmentId}`)
    return { error: 'El PDF de cronograma se genero vacio (0 bytes). El correo NO fue enviado.' }
  }
  const safeName = (programName || 'Programa').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
  console.log(`[sendConfirmationEmail] PDF cronograma generado OK (${pdfBuffer.length} bytes) para enrollment #${enrollmentId}`)
  return {
    attachments: [{
      filename: `Cronograma-${safeName}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf'
    }]
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

  const freshEnroll = await getEnrollmentOdoo(enrollmentId)
  const odooEmail = freshEnroll?.odoo_email || data.odoo_email || `${lastName.toLowerCase()}.${firstName.toLowerCase()}@weeducacion.edu.pe`

  const { isNew } = await _resolveConfirmationEmailMode({ enrollmentId, odooEmail })

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
    const pdfResult = await _buildCronogramaAttachment({ enrollmentId, programName: data.program_name })
    if (pdfResult.error) return { success: false, error: pdfResult.error }
    attachments.push(...pdfResult.attachments)
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
  // Chequeamos via alias (no via id numerico): el sistema convive con dos
  // namespaces para "cuota saldada": 'we_inst_paid' (legacy, id=4454) y
  // 'we_payment_status_paid' (nuevo, id=2471). El check por id mágico solo
  // cachaba el legacy y permitía re-confirmar cuotas del namespace nuevo,
  // duplicando filas en payments.
  const { rows: instRows } = await pool.query(`
    SELECT pi.*, c.alias AS status_alias
      FROM payment_installments pi
      LEFT JOIN catalog c ON c.catalog_id = pi.cat_status
     WHERE pi.installment_id = $1 AND pi.enrollment_id = $2
  `, [installmentId, enrollmentId])
  const inst = instRows?.[0]
  if (!inst) throw new Error('Cuota no encontrada')
  if (['we_inst_paid', 'we_payment_status_paid'].includes(inst.status_alias)) {
    throw new Error('Esta cuota ya esta pagada')
  }

  const paidAt = paymentDate ? new Date(paymentDate) : new Date()

  // Las cuatro escrituras (estado de cuota, registro de pago, moneda y token)
  // deben aplicarse de forma atomica: si una falla a media operacion, no podemos
  // dejar la cuota marcada como pagada sin la fila en payments correspondiente.
  await withTransaction(async client => {
    await client.query(
      'UPDATE payment_installments SET cat_status = 4454 WHERE installment_id = $1',
      [installmentId]
    )

    await client.query(`
      INSERT INTO payments (enrollment_id, installment_id, amount, payment_date, transaction_code,
        cat_method_payment, cat_payment_type, cat_settlement_status,
        settled_in_account_id, evidence_url, active, user_registration_id, registration_date)
      VALUES ($1, $2, $3, $4, $5, $6, 3115, 2573, $7, $8, 'Y', $9, NOW())
    `, [enrollmentId, installmentId, inst.amount, paidAt, transactionCode || '', catPaymentMedium || null, bankAccountId || null, voucherUrl || null, userId])

    if (catCurrency) {
      await client.query('UPDATE enrollments SET cat_currency = $1 WHERE enrollment_id = $2', [catCurrency, enrollmentId])
    }

    await client.query(
      "UPDATE payment_tokens SET status = 'confirmed', confirmed_by = $1, updated_at = NOW() WHERE enrollment_id = $2 AND status != 'confirmed'",
      [userId, enrollmentId]
    )
  })

  // Audit y sync con Odoo viven fuera de la transaccion: son side-effects que
  // no deben revertir el cobro si fallan.
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
    LEFT JOIN catalog c ON c.catalog_id = ba.business_entity_catalog_id
    WHERE ba.account_id = $1
  `, [accountId])
  return rows?.[0]?.description || null
}

async function _insertPrePaymentPlaceholder ({ enrollmentId, fields, userId }) {
  const { rows: instRows } = await pool.query(
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

  await pool.query(`
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
  if (pSets.length > 0) {
    if (oldP.payment_id) {
      pParams.push(oldP.payment_id)
      await pool.query(`UPDATE payments SET ${pSets.join(', ')} WHERE payment_id = $${pIdx}`, pParams)
    } else {
      // Sin fila previa en payments: la edicion pre-pago se persiste como placeholder
      // (cat_settlement_status=pending) anclado a la cuota inicial. No cuenta como pagado
      // y sera reemplazado por la fila definitiva cuando FICO confirme el pago real.
      await _insertPrePaymentPlaceholder({ enrollmentId, fields, userId })
    }
  }

  if (fields.cat_currency !== undefined && fields.cat_currency !== oldE.cat_currency) {
    const oldLabel = await resolveLabel(oldE.cat_currency)
    const newLabel = await resolveLabel(fields.cat_currency)
    changes['Tipo Moneda'] = { old: oldLabel || '---', new: newLabel || '---' }
  }
  if (fields.cat_payment_medium !== undefined && fields.cat_payment_medium !== oldP.cat_method_payment) {
    const oldLabel = await resolveLabel(oldP.cat_method_payment)
    const newLabel = await resolveLabel(fields.cat_payment_medium)
    changes['Medio de Pago'] = { old: oldLabel || '---', new: newLabel || '---' }
  }
  if (fields.bank_account_id !== undefined && fields.bank_account_id !== oldP.settled_in_account_id) {
    const oldLabel = await resolveBankLabel(oldP.settled_in_account_id)
    const newLabel = await resolveBankLabel(fields.bank_account_id)
    changes['Cuenta Bancaria'] = { old: oldLabel || '---', new: newLabel || '---' }

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

  // Edicion de cuotas pagadas (tab Cuotas con "Editar datos" activo).
  // El diff llega ya pre-computado desde el front (before/after) para mantener
  // este endpoint declarativo y evitar otro round-trip. Se persiste de forma
  // atomica: si una cuota falla, todo el bloque se revierte.
  if (fields.paid_installments && Array.isArray(fields.paid_installments) && fields.paid_installments.length > 0) {
    const amountDeltas = []
    await withTransaction(async client => {
      for (const row of fields.paid_installments) {
        if (!row.installment_id || !row.before || !row.after) continue
        const { installment_id, installment_number, before, after } = row

        // payment_installments: monto y vencimiento son las dos columnas de pago
        // que vive en esta tabla (las demas son metadata en `payments`).
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

        // payments: medio, cuenta, n. operacion, fecha y monto. Si la fila no llego
        // resuelta desde el front, la buscamos por installment_id activa.
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

        // cat_currency vive en `enrollments` (es global). Si la cuota lo movio,
        // lo propagamos a la inscripcion entera — comportamiento simetrico al
        // path del inicial mas arriba.
        if ((after.cat_currency || null) !== (before.cat_currency || null) && after.cat_currency) {
          await client.query('UPDATE enrollments SET cat_currency = $1 WHERE enrollment_id = $2', [after.cat_currency, enrollmentId])
        }
      }

      // Si algun monto cambio, recalcular total_amount y list_price a partir de
      // la suma actualizada de cuotas. Mantiene total = inicial + suma(cuotas)
      // como el sistema espera (saldo, vistas, Odoo).
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
        // list_price - discount = total: mantenemos esa invariante al ajustar.
        const newList = newTotal + oldDisc
        await client.query(
          'UPDATE enrollments SET total_amount = $1, list_price = $2 WHERE enrollment_id = $3',
          [newTotal, newList, enrollmentId]
        )
        changes['Total Recalculado'] = { old: `S/. ${oldList - oldDisc}`, new: `S/. ${newTotal}` }
      }
    })

    // Etiquetas legibles para audit: una linea agregada por cada cuota tocada.
    for (const row of fields.paid_installments) {
      const lines = []
      const { before, after, installment_number } = row
      if (Number(after.amount) !== Number(before.amount)) {
        lines.push(`monto S/. ${before.amount} → S/. ${after.amount}`)
      }
      if ((after.due_date || null) !== (before.due_date || null)) {
        const fmtD = d => d ? d.split('-').reverse().join('/') : '---'
        lines.push(`vencimiento ${fmtD(before.due_date)} → ${fmtD(after.due_date)}`)
      }
      if ((after.cat_currency || null) !== (before.cat_currency || null)) {
        const o = await resolveLabel(before.cat_currency); const n = await resolveLabel(after.cat_currency)
        lines.push(`moneda ${o || '---'} → ${n || '---'}`)
      }
      if ((after.cat_payment_medium || null) !== (before.cat_payment_medium || null)) {
        const o = await resolveLabel(before.cat_payment_medium); const n = await resolveLabel(after.cat_payment_medium)
        lines.push(`medio ${o || '---'} → ${n || '---'}`)
      }
      if ((after.bank_account_id || null) !== (before.bank_account_id || null)) {
        const o = await resolveBankLabel(before.bank_account_id); const n = await resolveBankLabel(after.bank_account_id)
        lines.push(`cuenta ${o || '---'} → ${n || '---'}`)
      }
      if ((after.transaction_code || '') !== (before.transaction_code || '')) {
        lines.push(`n.op ${before.transaction_code || '---'} → ${after.transaction_code || '---'}`)
      }
      const beforePay = before.payment_date ? String(before.payment_date).slice(0, 10) : ''
      const afterPay = after.payment_date ? String(after.payment_date).slice(0, 10) : ''
      if (afterPay !== beforePay) {
        const fmtD = d => d ? d.split('-').reverse().join('/') : '---'
        lines.push(`fecha pago ${fmtD(beforePay)} → ${fmtD(afterPay)}`)
      }
      if (lines.length) {
        changes[`Cuota #${installment_number}`] = { old: '(pagada)', new: lines.join(', ') }
      }
    }
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

async function editSellerAgent ({ enrollmentId, newSellerAgentId, newAgentOrigin, justificacion, userId }) {
  // Hay dos modos de invocacion:
  //  - Legacy (sin newAgentOrigin): solo cambia el asesor, el canal se deriva
  //    segun reglas heuristicas (asesor null -> 'SA', salida de 'SA' -> null,
  //    resto preserva). Se mantiene por compatibilidad con clientes antiguos.
  //  - Nuevo (con newAgentOrigin): el cliente eligio canal explicito desde el
  //    selector UI (categorias comercial/b2b/web/we/sa). El backend persiste
  //    tal cual lo recibe; null/'' = comercial sin canal.
  const isSinAsesor = newSellerAgentId === null || newSellerAgentId === undefined
  const newAgentIdN = isSinAsesor ? null : Number(newSellerAgentId)
  const useExplicitOrigin = newAgentOrigin !== undefined
  const explicitOrigin = (newAgentOrigin === '' || newAgentOrigin === null) ? null : newAgentOrigin

  const { rows: oldRows } = await pool.query(`
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

  const old = oldRows?.[0]
  if (!old) throw new Error('Inscripcion no encontrada')
  if (old.fico_status_alias !== 'we_enrollment_status_checked') {
    throw new Error('Solo se puede editar el asesor en inscripciones aprobadas')
  }

  const oldAgentIdN = old.old_agent_id == null ? null : Number(old.old_agent_id)
  const oldOrigin = old.old_origin

  // Calcular newOrigin antes de detectar no-op para que el chequeo cubra tambien
  // cambios solo-de-canal (mismo asesor, distinto canal).
  let newOrigin
  if (useExplicitOrigin) {
    newOrigin = explicitOrigin
  } else {
    // Logica legacy: SA si no hay asesor, limpia SA al volver a un asesor real.
    if (isSinAsesor) newOrigin = 'SA'
    else if (oldOrigin === 'SA') newOrigin = null
    else newOrigin = oldOrigin
  }

  if (oldAgentIdN === newAgentIdN && (oldOrigin || null) === (newOrigin || null)) {
    throw new Error('No hay cambios: el canal y el asesor son los mismos que los actuales')
  }

  let newAlias = null
  if (!isSinAsesor) {
    const { rows: newRows } = await pool.query(
      'SELECT alias FROM users WHERE user_id = $1', [newAgentIdN]
    )
    if (!newRows?.[0]) throw new Error('Asesor seleccionado no existe')
    newAlias = newRows[0].alias
  }

  await pool.query(
    'UPDATE enrollments SET seller_agent_id = $1, agent_origin = $2 WHERE enrollment_id = $3',
    [newAgentIdN, newOrigin, enrollmentId]
  )

  // El cambio puede introducir un nuevo string compuesto (ej. 'B2B - AE30')
  // en el universo de seller_agent_name; descartamos la cache para que el
  // proximo enrollmentAdvisorsList lo recoja sin esperar el TTL de 5 min.
  invalidateAdvisorsCache()

  const fmtAgent = (alias, origin) => {
    if (alias && origin) return `${origin} - ${alias}`
    if (alias) return alias
    if (origin) return origin
    return '(sin asesor)'
  }
  const changes = {
    'Asesor': {
      old: fmtAgent(old.old_alias, old.old_origin),
      new: fmtAgent(newAlias, newOrigin)
    }
  }

  await logAudit({
    enrollmentId,
    action: 'seller_agent_changed',
    userId,
    justificacion,
    changes,
    details: `Asesor: ${changes['Asesor'].old} → ${changes['Asesor'].new}`
  })

  return { result: 1, message: 'Asesor actualizado correctamente' }
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

  // Cancelar solo cuotas NO pagadas. Acepta ambos aliases de "saldada":
  // we_inst_paid (4454, legacy) y we_payment_status_paid (2471, nuevo).
  const { rows: cancelledInstallments } = await pool.query(`
    UPDATE payment_installments SET cat_status = 4456
    WHERE enrollment_id = $1 AND cat_status NOT IN (4454, 2471)
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
    // No borrar cuotas pagadas (legacy 4454 ni nuevo 2471). Si una cuota fue
    // pagada con el alias nuevo, el filtro != 4454 antes la borraba: bug silencioso.
    await pool.query(`DELETE FROM payment_installments WHERE enrollment_id = $1 AND cat_status NOT IN (4454, 2471)`, [child.enrollment_id])
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

// Hard delete fisico de una inscripcion (admin-only). Borra padre + hijos en
// cascada junto con todas las tablas dependientes. NO toca Odoo: la sale.order
// y la matricula en aula online quedan intactas (limpieza manual del admin).
// El lead asociado se desvincula (enrollment_id = NULL) y se reabre como
// consulta activa para no perder el contacto comercial.
async function deleteEnrollment ({ enrollmentId, userId }) {
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

    // payments.installment_id apunta a payment_installments (fk_payment_installment),
    // asi que payments DEBE borrarse antes que payment_installments. Las demas
    // tablas solo referencian enrollment_id directo.
    await client.query('DELETE FROM payments WHERE enrollment_id = ANY($1::int[])', [allIds])
    await client.query('DELETE FROM payment_installments WHERE enrollment_id = ANY($1::int[])', [allIds])
    await client.query('DELETE FROM enrollment_validations WHERE enrollment_id = ANY($1::int[])', [allIds])
    await client.query('DELETE FROM enrollment_attachments WHERE enrollment_id = ANY($1::int[])', [allIds])
    await client.query('DELETE FROM enrollment_audit_log WHERE enrollment_id = ANY($1::int[])', [allIds])
    await client.query('DELETE FROM email_logs WHERE enrollment_id = ANY($1::int[])', [allIds])
    await client.query('DELETE FROM payment_tokens WHERE enrollment_id = ANY($1::int[])', [allIds])

    // El lead se conserva para no perder rastro comercial; se devuelve al pool
    // de consultas activas desvinculando la inscripcion. cat_status_lead es
    // NOT NULL, asi que se reasigna al status "atendido" (consulta abierta).
    // Si el alias no existiera se mantiene el status actual.
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

    // Primero los hijos para no violar la FK self-referencial parent_enrollment_id.
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

  // Email/telefono: rutear el UPDATE a la misma fuente que alimenta STUDENT_EMAIL_SQL.
  // Inscripciones FICO directas (B2B/walk-in/web) no tienen lead — los datos viven solo
  // en person_contacts. Sin este branch, el UPDATE a leads con lead_id=NULL no afecta
  // ninguna fila y el cambio queda registrado en historial pero no en la BD real.
  if (changes['Email'] || changes['Telefono']) {
    if (current.lead_id) {
      const updFields = []
      const updValues = []
      let idx = 1
      if (changes['Email'])    { updFields.push(`origin_email = $${idx++}`); updValues.push(originEmail) }
      if (changes['Telefono']) { updFields.push(`origin_phone = $${idx++}`); updValues.push(originPhone) }
      updValues.push(current.lead_id)
      await pool.query(`UPDATE leads SET ${updFields.join(', ')} WHERE lead_id = $${idx}`, updValues)
    } else {
      if (changes['Email']) {
        await pool.query(
          `UPDATE person_contacts
              SET value = $1
            WHERE person_id = $2
              AND cat_way_contact = (SELECT catalog_id FROM catalog WHERE alias = 'we_way_contact_email' LIMIT 1)
              AND active = 'Y'`,
          [originEmail, current.person_id]
        )
      }
      if (changes['Telefono']) {
        await pool.query(
          `UPDATE person_contacts
              SET value = $1
            WHERE person_id = $2
              AND cat_way_contact = (SELECT catalog_id FROM catalog WHERE alias = 'we_way_contact_phone' LIMIT 1)
              AND active = 'Y'`,
          [originPhone, current.person_id]
        )
      }
    }
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

// Edita el monto de UNA cuota pendiente. Audita old -> new con justificacion.
// Rechaza si la cuota esta pagada o si pertenece a otra inscripcion (defensa).
async function editInstallmentAmount ({ enrollmentId, installmentId, newAmount, justificacion, userId }) {
  const amt = Number(newAmount)
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('Monto invalido')
  if (!justificacion || !justificacion.trim()) throw new Error('Justificacion obligatoria')

  const { rows } = await pool.query(`
    SELECT pi.installment_id, pi.installment_number, pi.amount, pi.enrollment_id, cs.alias AS status_alias
      FROM payment_installments pi
      JOIN catalog cs ON cs.catalog_id = pi.cat_status
     WHERE pi.installment_id = $1 AND pi.enrollment_id = $2
  `, [installmentId, enrollmentId])

  const inst = rows?.[0]
  if (!inst) throw new Error('Cuota no encontrada para esta inscripcion')
  if (inst.installment_number === 0) throw new Error('Usa el flujo de pago inicial para esa fila')
  if (['we_inst_paid', 'we_payment_status_paid'].includes(inst.status_alias)) {
    throw new Error('No se puede editar el monto de una cuota ya pagada')
  }

  const oldAmount = Number(inst.amount || 0)
  if (Math.abs(oldAmount - amt) < 0.001) throw new Error('El monto nuevo es igual al actual')

  await pool.query(
    'UPDATE payment_installments SET amount = $1 WHERE installment_id = $2',
    [amt, installmentId]
  )

  const fmtMoney = n => `S/. ${Number(n).toFixed(2)}`
  const changes = {
    [`Monto cuota #${inst.installment_number}`]: { old: fmtMoney(oldAmount), new: fmtMoney(amt) }
  }
  const details = `Monto cuota #${inst.installment_number}: ${fmtMoney(oldAmount)} → ${fmtMoney(amt)}`

  await logAudit({
    enrollmentId,
    action: 'installment_amount_edited',
    userId,
    justificacion,
    changes,
    details
  })

  return { result: 1, message: 'Monto actualizado', old_amount: oldAmount, new_amount: amt }
}

// Agrega UNA cuota a una inscripcion ya aprobada. Calcula el siguiente
// installment_number automaticamente y la deja en estado Pendiente.
// Audita con detalle de monto + vencimiento + justificacion.
async function addInstallment ({ enrollmentId, amount, dueDate, justificacion, userId }) {
  const amt = Number(amount)
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('Monto invalido')
  if (!dueDate) throw new Error('Fecha de vencimiento obligatoria')
  if (!justificacion || !justificacion.trim()) throw new Error('Justificacion obligatoria')

  const isoDate = String(dueDate).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error('Fecha invalida (formato YYYY-MM-DD)')

  const { rows: enrRows } = await pool.query(
    'SELECT enrollment_id FROM enrollments WHERE enrollment_id = $1 AND active = $2',
    [enrollmentId, 'Y']
  )
  if (!enrRows.length) throw new Error('Inscripcion no encontrada')

  const { rows: pendingCat } = await pool.query(
    "SELECT catalog_id FROM catalog WHERE alias = 'we_inst_pending' LIMIT 1"
  )
  const pendingStatusId = pendingCat?.[0]?.catalog_id
  if (!pendingStatusId) throw new Error('Catalogo we_inst_pending no encontrado')

  // Siguiente installment_number = MAX(actuales > 0) + 1. Excluye el 0 (inicial/reserva).
  const { rows: maxRows } = await pool.query(
    `SELECT COALESCE(MAX(installment_number), 0) AS max_num
       FROM payment_installments
      WHERE enrollment_id = $1 AND installment_number > 0`,
    [enrollmentId]
  )
  const nextNum = Number(maxRows[0].max_num) + 1

  const { rows: inserted } = await pool.query(
    `INSERT INTO payment_installments (enrollment_id, installment_number, amount, due_date, cat_status)
     VALUES ($1, $2, $3, $4::date, $5)
     RETURNING installment_id`,
    [enrollmentId, nextNum, amt, isoDate, pendingStatusId]
  )

  const fmtMoney = n => `S/. ${Number(n).toFixed(2)}`
  const fmtFecha = iso => iso.split('-').reverse().join('/')
  const changes = {
    [`Cuota #${nextNum}`]: { old: '---', new: `${fmtMoney(amt)} · vence ${fmtFecha(isoDate)}` }
  }
  const details = `Cuota #${nextNum} agregada: ${fmtMoney(amt)}, vence ${fmtFecha(isoDate)}`

  await logAudit({
    enrollmentId,
    action: 'installment_added',
    userId,
    justificacion,
    changes,
    details
  })

  return {
    result: 1,
    message: 'Cuota agregada',
    installment_id: inserted[0].installment_id,
    installment_number: nextNum
  }
}

// Bloquea registros duplicados antes de invocar al SP. Un duplicado es la misma
// edicion (program_edition_id) con la misma persona — identificada por documento
// si existe o por email (FICO suele inscribir B2B sin DNI). Solo cuentan
// inscripciones activas; las retiradas no impiden una re-inscripcion legitima.
async function _findFicoDuplicateEnrollment ({ programEditionId, documentNumber, email }) {
  if (!programEditionId) return null
  const doc = documentNumber && String(documentNumber).trim() ? String(documentNumber).trim() : null
  const mail = email && String(email).trim() ? String(email).trim() : null
  if (!doc && !mail) return null

  const { rows } = await pool.query(`
    SELECT
      e.enrollment_id,
      e.registration_date,
      e.agent_origin,
      pv.abbreviation                                     AS program_name,
      pe.global_code                                      AS edition_code,
      per.document_number                                 AS existing_document,
      TRIM(per.first_name || ' ' || per.last_name)        AS existing_student_name,
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

async function ficoEnrollmentRegister ({ data, userId }) {
  const duplicate = await _findFicoDuplicateEnrollment({
    programEditionId: data.program_edition_id,
    documentNumber: data.document_number,
    email: data.email
  })
  if (duplicate) {
    const who = [duplicate.seller_agent_alias, duplicate.agent_origin].filter(Boolean).join(' - ') || 'otro asesor'
    const when = duplicate.registration_date
      ? new Date(duplicate.registration_date).toLocaleDateString('es-PE', { timeZone: 'America/Lima' })
      : 'fecha no registrada'
    return {
      result: 2,
      message: `No se puede registrar: ${duplicate.existing_student_name || 'el alumno'} ya esta inscrito en ${duplicate.program_name || 'este programa'} ${duplicate.edition_code || ''} (registrado por ${who} el ${when}).`,
      duplicate_info: {
        enrollment_id:   duplicate.enrollment_id,
        student_name:    duplicate.existing_student_name,
        document_number: duplicate.existing_document,
        program_name:    duplicate.program_name,
        edition_code:    duplicate.edition_code,
        registration_date: duplicate.registration_date,
        registered_by:   who
      }
    }
  }

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
    installment_plan: data.installment_plan || null,
    // Descuentos: el SP los procesa en cascada (porcentaje -> promocion stick
    // -> beneficios) e inserta en enrollment_discounts. Si no vienen, el SP
    // respeta el total_amount tal cual y discount_amount queda en 0.
    dsct_porcent_id: data.dsct_porcent_id ?? null,
    dsct_stick_id: data.dsct_stick_id ?? null,
    dsct_benefit_ids: Array.isArray(data.dsct_benefit_ids) ? data.dsct_benefit_ids : []
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

    // Refresh inmediato de la MV: el operador ya ve el padre en el listado
    // mientras Odoo/email/hijos corren en background. Fire-and-forget.
    refreshEnrollmentMv('on-register-sync')

    // Encolamos hijos + Odoo + email para ejecutar en background. El worker los
    // procesa en orden topologico (children -> odoo -> email) respetando las
    // dependencias documentadas en job-worker.cron.js. Esto baja el tiempo de
    // respuesta de ~15s a ~3s y permite retries con backoff ante fallos de
    // Odoo o email — antes esos errores quedaban silenciados en safeAsync.
    let registerJobId = null
    try {
      const job = await enqueueJob({
        jobType: 'register_followup',
        enrollmentId: eid,
        payload: { userId }
      })
      registerJobId = job.job_id
    } catch (qErr) {
      console.error('[ficoEnrollmentRegister] enqueue register_followup fallo:', qErr.message)
    }
    enrollResp.email_pending = true
    enrollResp.job_id = registerJobId
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
      // Solo desplazar cuotas pendientes. No tocar pagadas (we_inst_paid 4454
      // ni we_payment_status_paid 2471) — alterar su due_date confunde reportes.
      const { rows: updatedCuotas } = await pool.query(`
        UPDATE payment_installments
        SET due_date = due_date + INTERVAL '${diffDays} days'
        WHERE enrollment_id = $1 AND cat_status NOT IN (4454, 2471)
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
      const od = await getEnrollmentOdoo(enrollmentId).catch(() => null)

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
  return queryProgramPrice(programVersionId)
}

// Clona el lead del enrollment original para asociarlo a la nueva inscripcion del cambio de curso.
// Mantiene todos los campos originales pero apunta al nuevo programa/edicion y resetea fechas.
// Registra la fila en course_changes con metadata del cambio.
async function _ccRecordCourseChangeRow ({ old, newEid, newProgramVersionId, newEditionId, totalAmount, justificacion, userId, oldAmount, executor = pool }) {
  await executor.query(`
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
    const od = await getEnrollmentOdoo(enrollmentId)
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

// Arma el payload de inscripcion para el SP `sp_fico_enrollment_register_direct`
// en el contexto de un cambio de curso. Reusa identidad y modalidad de la
// inscripcion origen, fija "Sin Asesor" (SA) en la nueva venta porque la
// comision ya quedo registrada en la inscripcion previa, y aplica los nuevos
// datos de cobranza (metodo, banco, transaccion) si vienen en el payload.
async function _buildCourseChangeInscription ({ old, newProgramVersionId, newEditionId, totalAmount, ccNote, cat_currency, cat_method_payment, cat_business_entity, bank_account_id, transaction_code, ticket_payment_urls }) {
  const ccContadoCatId = await getCatalogIdByAlias(ALIAS.PAYMENT_WAY_SINGLE)
  const { rows: oldPayment } = await pool.query(
    `SELECT cat_method_payment FROM payments WHERE enrollment_id = $1 AND active = 'Y' ORDER BY payment_id DESC LIMIT 1`,
    [old.enrollment_id]
  )
  let methodPayment = oldPayment?.[0]?.cat_method_payment || null
  if (!methodPayment) {
    methodPayment = await getCatalogIdByAlias(ALIAS.PAYMENT_METHOD_TRANSFER)
  }

  return {
    document_number: old.document_number,
    cat_type_document: old.cat_type_document,
    first_name: old.first_name,
    last_name: old.last_name,
    email: old.origin_email,
    phone: old.origin_phone,
    program_version_id: newProgramVersionId,
    program_edition_id: newEditionId,
    cat_insc_modality: old.cat_inscription_modality,
    cat_payment_channel: old.cat_payment_channel,
    cat_currency: cat_currency || old.cat_currency,
    cat_payment_way: ccContadoCatId || old.cat_payment_plan,
    cat_payment_medium: cat_method_payment || methodPayment,
    cat_business_entity: cat_business_entity || null,
    bank_account_id: bank_account_id || null,
    transaction_code: transaction_code || null,
    payment_date: new Date().toISOString().slice(0, 10),
    list_price: totalAmount || 0,
    total_amount: totalAmount,
    saved_money: 0,
    is_scholarship: false,
    cat_b2b_doctype: null,
    // En CC la nueva venta NO se acredita a ningun asesor — la venta original
    // ya quedo registrada (asesor + status=course_changed). Convencion del
    // codebase para "Sin Asesor": agent_origin='SA', seller_agent_id=null.
    seller_agent_id: null,
    agent_origin: 'SA',
    client_profile: null,
    observations: ccNote,
    ticket_payment_urls: ticket_payment_urls || [],
    installment_plan: null
  }
}

async function courseChange ({ enrollmentId, newProgramVersionId, newEditionId, totalAmount, justificacion, userId, cat_currency, cat_method_payment, cat_business_entity, bank_account_id, transaction_code, ticket_payment_urls }) {
  const { rows: oldRows } = await pool.query(`
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

  // CC ya NO clona el lead. La consulta original queda intacta vinculada a la
  // inscripcion origen (que tiene su asesor + cat_type_status='course_changed').
  // La nueva inscripcion entra como FICO directa: sin lead, sin asesor (S/A),
  // misma persona reusada por document_number.
  const inscription = await _buildCourseChangeInscription({
    old, newProgramVersionId, newEditionId, totalAmount, ccNote,
    cat_currency, cat_method_payment, cat_business_entity,
    bank_account_id, transaction_code, ticket_payment_urls
  })

  const enrollRows = await callProcedureReturningRows(
    pool,
    'public.sp_fico_enrollment_register_direct',
    [userId, JSON.stringify({ inscription })],
    { statementTimeoutMs: 25000 }
  )

  const newEnroll = enrollRows?.[0] || { result: 0, message: 'Sin respuesta del SP' }
  if (newEnroll.result !== 1) {
    throw new Error(newEnroll.message || 'Error al crear la inscripcion destino')
  }

  const newEid = newEnroll.enrollment_id

  // Bloque atomico: una vez creado el nuevo enrollment via el SP, las cuatro
  // operaciones que siguen (estado FICO, vinculo al padre, ajuste de payment,
  // registro en course_changes) deben aplicarse en bloque. Si fallan a medio
  // camino quedaria un enrollment huerfano sin parent_enrollment_id o un
  // course_change no registrado.
  const ccCheckedCatId = await getCatalogIdByAlias(ALIAS.ENROLLMENT_STATUS_CHECKED)
  const oldAmount = Number(old.total_amount || 0) - Number(old.discount_amount || 0)

  if (newEid) {
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

      await _ccRecordCourseChangeRow({
        old: { ...old, enrollment_id: enrollmentId },
        newEid,
        newProgramVersionId, newEditionId,
        totalAmount, justificacion, userId,
        oldAmount,
        executor: client
      })
    })
  }

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
    // Audit del nuevo eid: mostramos origen Y destino para que la trazabilidad
    // sea explicita en ambos lados (mirror del audit que se hace en el viejo).
    await logAudit({
      enrollmentId: newEid,
      action: 'created_from_cc',
      userId,
      justificacion,
      changes: {
        'Programa origen':  { old: '---', new: `${old.old_program_name || '---'} - ${old.old_edition_code || '---'} (${fmtDate(old.old_start_date)})` },
        'Programa destino': { old: '---', new: `${newEd.new_program_name || '---'} - ${newEd.global_code || '---'} (${fmtDate(newEd.start_date)})` },
        'Enrollment origen': { old: '---', new: `#${enrollmentId}` }
      },
      details: `Cambio de curso: ${old.old_program_name} ${old.old_edition_code} → ${newEd.new_program_name} ${newEd.global_code}`
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
    // Acepta ambos namespaces: legacy (4454) y nuevo (2471 = we_payment_status_paid).
    if (inst.cat_status === 4454 || inst.cat_status === 2471) {
      throw new Error(`La cuota ${inst.installment_number} ya esta pagada`)
    }

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

async function getClassroomExportOptions () {
  const { rows } = await pool.query(`
    WITH approved AS (
      SELECT e.enrollment_id, e.program_version_id, e.program_edition_id
        FROM public.enrollments e
        JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
        LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
        LEFT JOIN public.programs prog ON prog.program_id = pv.program_id
       WHERE cf.alias = 'we_enrollment_status_checked'
         AND e.active = 'Y'
         AND e.program_edition_id IS NOT NULL
         AND COALESCE(prog.is_membership, false) = false
         AND (
              e.parent_enrollment_id IS NOT NULL
           OR NOT EXISTS (SELECT 1 FROM public.enrollments c WHERE c.parent_enrollment_id = e.enrollment_id)
         )
    )
    SELECT
      pv.program_version_id,
      pv.version_code,
      pv.abbreviation,
      a.program_edition_id   AS edition_num_id,
      pe.start_date,
      COUNT(*)::int          AS students_count
      FROM approved a
      JOIN public.program_versions pv ON pv.program_version_id = a.program_version_id
      LEFT JOIN public.program_editions pe ON pe.edition_num_id = a.program_edition_id
     GROUP BY pv.program_version_id, pv.version_code, pv.abbreviation,
              a.program_edition_id, pe.start_date
     ORDER BY pv.version_code, pe.start_date NULLS LAST
  `)

  const programsMap = new Map()
  for (const r of rows) {
    if (!programsMap.has(r.program_version_id)) {
      programsMap.set(r.program_version_id, {
        program_version_id: r.program_version_id,
        version_code: r.version_code,
        abbreviation: r.abbreviation,
        editions: []
      })
    }
    programsMap.get(r.program_version_id).editions.push({
      edition_num_id: r.edition_num_id,
      start_date: r.start_date,
      students_count: r.students_count
    })
  }
  return Array.from(programsMap.values())
}

async function exportClassroomCsv ({ programVersionId, editionNumId }) {
  const { rows } = await pool.query(`
    WITH approved AS (
      SELECT e.enrollment_id
        FROM public.enrollments e
        JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
       WHERE cf.alias = 'we_enrollment_status_checked'
         AND e.active = 'Y'
         AND e.program_version_id = $1
         AND e.program_edition_id = $2
         AND (
              e.parent_enrollment_id IS NOT NULL
           OR NOT EXISTS (SELECT 1 FROM public.enrollments c WHERE c.parent_enrollment_id = e.enrollment_id)
         )
    )
    SELECT
      TRIM(BOTH FROM concat(per.first_name, ' ', per.last_name)) AS nombres_apellidos,
      COALESCE(pv_parent.version_code, '')                       AS cat_prog,
      CASE c_mod.alias
        WHEN 'we_insc_modality_flexible' THEN 'FLEX'
        ELSE 'REGULAR'
      END                                                        AS modalidad,
      COALESCE(
        l.origin_phone,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_phone'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      )                                                          AS celular,
      COALESCE(
        l.origin_email,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_email'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      )                                                          AS correo,
      CASE c_prof.alias
        WHEN 'we_profile_student' THEN 'E'
        ELSE 'P'
      END                                                        AS ocup
      FROM public.enrollments e
      JOIN approved a ON a.enrollment_id = e.enrollment_id
      JOIN public.customers cust ON cust.customer_id = e.customer_id
      JOIN public.persons per   ON per.person_id   = cust.person_id
      LEFT JOIN public.leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN public."catalog" c_prof ON c_prof.catalog_id = e.cat_profile_id
      LEFT JOIN public."catalog" c_mod  ON c_mod.catalog_id  = e.cat_inscription_modality
      LEFT JOIN public.enrollments e_parent ON e_parent.enrollment_id = e.parent_enrollment_id
      LEFT JOIN public.program_versions pv_parent ON pv_parent.program_version_id = e_parent.program_version_id
     ORDER BY per.last_name, per.first_name
  `, [programVersionId, editionNumId])

  const headers = ['Nombres y Apellidos', 'N° Grp', 'Cat Prog', 'Usuario', 'Contraseña', 'Modalidad', 'Celular', 'Correo', 'Ocup']
  const escape = v => {
    const s = v == null ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.map(escape).join(',')]
  for (const r of rows) {
    lines.push([
      r.nombres_apellidos || '',
      '',
      r.cat_prog || '',
      '',
      '',
      r.modalidad || '',
      r.celular || '',
      r.correo || '',
      r.ocup || ''
    ].map(escape).join(','))
  }
  return '﻿' + lines.join('\r\n')
}

// Aprueba una inscripcion en estado "pendiente a revisar" creada por
// migracion A5. El SP transfiere cuotas pendientes y convalidaciones; aqui
// hacemos los side effects externos (Odoo + correo + crear hijos si es padre).
async function approvePendingReview ({ enrollmentId, userId }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_enrollment_pending_review_approve',
    [JSON.stringify({ enrollment_id: enrollmentId }), userId],
    { statementTimeoutMs: 30000 }
  )
  const summary = rows?.[0]
  if (!summary || summary.result !== 1) {
    return summary || { result: 0, message: 'Sin respuesta del SP' }
  }

  // Si el origen era padre (ESP/Diplomado), crear hijos en la nueva edicion
  // respetando convalidaciones que el SP ya copio.
  if (summary.is_parent) {
    await safeAsync('[A5Approve][Children] create', () => createChildEnrollments({ enrollmentId, userId }))
  }

  // Odoo: si el programa tiene odoo_activation, desinscribir el slide_group viejo
  // del origen y reinscribir en el nuevo. Idempotente respecto al estado actual.
  const { rows: progRows } = await pool.query(`
    SELECT prog.odoo_activation
      FROM enrollments e
      JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      JOIN programs prog ON prog.program_id = pv.program_id
     WHERE e.enrollment_id = $1
  `, [enrollmentId])

  if (progRows?.[0]?.odoo_activation) {
    await safeAsync('[A5Approve][Odoo] enroll new', async () => {
      const res = await enrollInOdoo({ enrollmentId })
      if (res?.success) {
        await logAudit({ enrollmentId, action: 'odoo_enrolled', userId, details: `Inscrito en Odoo por aprobacion de migracion A5` })
      } else {
        await logAudit({ enrollmentId, action: 'odoo_enrolled', userId, details: `Pendiente inscripcion Odoo: ${res?.error || 'desconocido'}` })
      }
    })
  }

  await safeAsync('[A5Approve][Email] send', async () => {
    const res = await sendConfirmationEmail({ enrollmentId })
    if (!res?.success) {
      await logAudit({ enrollmentId, action: 'email_sent', userId, details: `Error enviando correo: ${res?.error || 'desconocido'}` })
    }
  })

  return summary
}

export default {
  enrollmentList,
  enrollmentAdvisorsList,
  invalidateAdvisorsCache,
  getKpisDaily,
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
  editInstallmentAmount,
  addInstallment,
  editSellerAgent,
  getCollections,
  confirmInstallment,
  previewConfirmationEmail,
  retireEnrollment,
  deleteEnrollment,
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
  validateChildEnrollmentSetup,
  createChildEnrollments,
  enrollInOdoo,
  getClassroomExportOptions,
  exportClassroomCsv,
  approvePendingReview
}
