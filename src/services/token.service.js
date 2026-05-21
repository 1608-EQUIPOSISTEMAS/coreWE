import crypto from 'node:crypto'
import { pool } from '../config/db.js'
import { callProcedureReturningRows } from '../utils/spHelper.js'
import slackClient from '../config/slack.js'

const MAX_TOKENS_PER_GROUP = 5
const MAX_GROUP_AMOUNT     = 3000

function inscriptionFullName (inscriptionData) {
  const insc = inscriptionData?.inscription
  if (!insc) return null
  const parts = [insc.full_name, insc.last_name, insc.mother_last_name]
    .map(s => (s || '').trim()).filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

async function logTokenEvent ({ tokenId, tokenIds, action, userId, details = null, changes = null }) {
  const ids = Array.isArray(tokenIds) ? tokenIds : [tokenId]
  const changesJson = changes ? JSON.stringify(changes) : null
  for (const id of ids) {
    await pool.query(`
      INSERT INTO enrollment_audit_log (token_id, action, performed_by, details, changes)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `, [id, action, userId || null, details, changesJson])
  }
}

// Bandera B2B del token: el lead asociado (lead vinculado a la inscripcion o el
// lead directo del token) tiene situacion 'we_prospect_situation_corporate'.
// Cuando es B2B, los nombres de asesor se muestran con prefijo 'B2B - ' para
// que el operador identifique el canal sin abrir el detalle. Sigue la misma
// convencion que `enrollmentAdvisorsList` en fico.service.js.
const BASE_SELECT = `
  SELECT pt.*,
    CASE WHEN e.enrollment_id IS NOT NULL
      THEN per.first_name || ' ' || per.last_name
      ELSE COALESCE(
        NULLIF(TRIM(COALESCE(pt.inscription_data->'inscription'->>'full_name','') || ' ' || COALESCE(pt.inscription_data->'inscription'->>'last_name','') || ' ' || COALESCE(pt.inscription_data->'inscription'->>'mother_last_name','')), ''),
        l_dir.full_name
      )
    END AS student_name,
    COALESCE(per.document_number, pt.inscription_data->'inscription'->>'document', '') AS document_number,
    COALESCE(l.origin_email, pt.inscription_data->'inscription'->>'email', l_dir.origin_email) AS student_email,
    COALESCE(l.origin_phone, l_dir.origin_phone) AS student_phone,
    COALESCE(pv.abbreviation, pv_dir.abbreviation) AS program_name,
    COALESCE(pe.global_code, pe_dir.global_code) AS edition_code,
    COALESCE(pe.start_date, pe_dir.start_date) AS edition_start_date,
    c_prov.description AS provider_name,
    CASE WHEN COALESCE(c_sit.alias, c_sit_dir.alias) = 'we_prospect_situation_corporate' AND u_req.alias IS NOT NULL
         THEN 'B2B - ' || u_req.alias
         ELSE u_req.alias
    END AS requested_by_name,
    CASE WHEN COALESCE(c_sit.alias, c_sit_dir.alias) = 'we_prospect_situation_corporate' AND u_cre.alias IS NOT NULL
         THEN 'B2B - ' || u_cre.alias
         ELSE u_cre.alias
    END AS created_by_name,
    u_conf.alias AS confirmed_by_name,
    (COALESCE(c_sit.alias, c_sit_dir.alias) = 'we_prospect_situation_corporate') AS is_b2b
  FROM payment_tokens pt
  LEFT JOIN enrollments e ON e.enrollment_id = pt.enrollment_id
  LEFT JOIN customers cust ON cust.customer_id = e.customer_id
  LEFT JOIN persons per ON per.person_id = cust.person_id
  LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
  LEFT JOIN catalog c_sit ON c_sit.catalog_id = l.cat_prospect_situation
  LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
  LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
  LEFT JOIN leads l_dir ON l_dir.lead_id = pt.lead_id
  LEFT JOIN catalog c_sit_dir ON c_sit_dir.catalog_id = l_dir.cat_prospect_situation
  LEFT JOIN program_versions pv_dir ON pv_dir.program_version_id = l_dir.program_version_id
  LEFT JOIN program_editions pe_dir ON pe_dir.edition_num_id = l_dir.program_edition_id
  LEFT JOIN catalog c_prov ON c_prov.catalog_id = pt.cat_provider
  LEFT JOIN users u_req ON u_req.user_id = pt.requested_by
  LEFT JOIN users u_cre ON u_cre.user_id = pt.created_by
  LEFT JOIN users u_conf ON u_conf.user_id = pt.confirmed_by
`

async function tokenList (filters = {}) {
  const conditions = []
  const params = []
  let idx = 1

  // Helper: querystring puede traer un array como repeticion (?k=a&k=b) o como
  // string CSV (?k=a,b). Normalizamos a array.
  const toArray = v => {
    if (v == null || v === '') return []
    if (Array.isArray(v)) return v.filter(x => x != null && x !== '')
    return String(v).split(',').map(s => s.trim()).filter(Boolean)
  }

  // Compat con la version anterior: status simple (string) sigue funcionando.
  if (filters.status) {
    conditions.push(`pt.status = $${idx++}`)
    params.push(filters.status)
  }

  // status_in: multi-select
  const statusIn = toArray(filters.status_in)
  if (statusIn.length) {
    conditions.push(`pt.status = ANY($${idx++}::text[])`)
    params.push(statusIn)
  }

  if (filters.provider) {
    conditions.push(`pt.cat_provider = $${idx++}`)
    params.push(Number(filters.provider))
  }

  const providersIn = toArray(filters.providers_in).map(Number).filter(Number.isFinite)
  if (providersIn.length) {
    conditions.push(`pt.cat_provider = ANY($${idx++}::int[])`)
    params.push(providersIn)
  }

  const paymentTypeIn = toArray(filters.payment_type_in)
  if (paymentTypeIn.length) {
    conditions.push(`pt.payment_type = ANY($${idx++}::text[])`)
    params.push(paymentTypeIn)
  }

  const requestedByIn = toArray(filters.requested_by_in).map(Number).filter(Number.isFinite)
  if (requestedByIn.length) {
    conditions.push(`COALESCE(pt.requested_by, pt.created_by) = ANY($${idx++}::int[])`)
    params.push(requestedByIn)
  }

  if (filters.installment_only === 'true' || filters.installment_only === true) {
    conditions.push(`pt.inscription_data->'inscription'->>'cat_type_payment' = 'we_payment_way_installments'`)
  } else if (filters.installment_only === 'false' || filters.installment_only === false) {
    conditions.push(`COALESCE(pt.inscription_data->'inscription'->>'cat_type_payment', '') <> 'we_payment_way_installments'`)
  }

  if (filters.currency) {
    conditions.push(`pt.currency = $${idx++}`)
    params.push(String(filters.currency))
  }

  if (filters.date_from) {
    conditions.push(`pt.created_at::date >= $${idx++}::date`)
    params.push(filters.date_from)
  }
  if (filters.date_to) {
    conditions.push(`pt.created_at::date <= $${idx++}::date`)
    params.push(filters.date_to)
  }

  // Busqueda libre (q): nombre, DNI, lead, programa, edicion.
  // search se mantiene como alias por compat.
  const q = filters.q || filters.search
  if (q) {
    conditions.push(`(
      per.first_name || ' ' || per.last_name ILIKE $${idx}
      OR per.document_number ILIKE $${idx}
      OR l_dir.full_name ILIKE $${idx}
      OR pv.abbreviation ILIKE $${idx}
      OR pv_dir.abbreviation ILIKE $${idx}
      OR pe.global_code ILIKE $${idx}
      OR pe_dir.global_code ILIKE $${idx}
      OR COALESCE(l.origin_email, l_dir.origin_email, '') ILIKE $${idx}
      OR COALESCE(l.origin_phone, l_dir.origin_phone, '') ILIKE $${idx}
    )`)
    params.push(`%${q}%`)
    idx++
  }

  if (filters.enrollment_id) {
    conditions.push(`pt.enrollment_id = $${idx++}`)
    params.push(Number(filters.enrollment_id))
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const page = Math.max(1, Number(filters.page) || 1)
  const size = Math.max(1, Math.min(100, Number(filters.size) || 25))
  const offset = (page - 1) * size

  // Joins replicados de BASE_SELECT — necesarios para que los WHERE referencien
  // pv/pe/pv_dir/pe_dir (busqueda por codigo de programa o edicion).
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM payment_tokens pt
    LEFT JOIN enrollments e ON e.enrollment_id = pt.enrollment_id
    LEFT JOIN customers cust ON cust.customer_id = e.customer_id
    LEFT JOIN persons per ON per.person_id = cust.person_id
    LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN leads l_dir ON l_dir.lead_id = pt.lead_id
    LEFT JOIN program_versions pv_dir ON pv_dir.program_version_id = l_dir.program_version_id
    LEFT JOIN program_editions pe_dir ON pe_dir.edition_num_id = l_dir.program_edition_id
    ${where}
  `

  const dataQuery = `
    ${BASE_SELECT}
    ${where}
    ORDER BY pt.created_at DESC
    LIMIT $${idx++} OFFSET $${idx++}
  `
  params.push(size, offset)

  const [countRes, dataRes] = await Promise.all([
    pool.query(countQuery, params.slice(0, params.length - 2)),
    pool.query(dataQuery, params)
  ])

  return {
    total: Number(countRes.rows[0]?.total ?? 0),
    page,
    size,
    items: dataRes.rows
  }
}


async function tokenGetById (tokenId) {
  const { rows } = await pool.query(`
    ${BASE_SELECT}
    WHERE pt.token_id = $1
  `, [tokenId])
  return rows[0] || null
}


async function tokenStats () {
  // Modelo de KPIs:
  // - pending: tokens esperando que FICO ponga link
  // - awaitingConfirmation: links enviados esperando que FICO confirme inscripcion (antes "linkSent")
  // - confirmedToday: tokens confirmados hoy (cerrados)
  // - amount: monto en espera (pending + link_sent), separado PEN/USD
  // Nota: el estado 'paid' existe en BD pero ningun flujo lo activa actualmente,
  // por eso no se cuenta como KPI separado. Los tokens van pending -> link_sent -> confirmed.
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending')   AS pending_count,
      COUNT(*) FILTER (WHERE status = 'link_sent') AS link_sent_count,
      COUNT(*) FILTER (WHERE status = 'confirmed' AND updated_at::date = CURRENT_DATE) AS confirmed_today_count,
      COALESCE(SUM(amount) FILTER (WHERE status IN ('pending','link_sent') AND currency = 'PEN'), 0) AS amount_pen,
      COALESCE(SUM(amount) FILTER (WHERE status IN ('pending','link_sent') AND currency = 'USD'), 0) AS amount_usd
    FROM payment_tokens
  `)
  const r = rows[0] || {}
  return {
    pending:              Number(r.pending_count          || 0),
    awaitingConfirmation: Number(r.link_sent_count        || 0),
    confirmedToday:       Number(r.confirmed_today_count  || 0),
    amountPen:            Number(r.amount_pen             || 0),
    amountUsd:            Number(r.amount_usd             || 0)
  }
}


async function tokenCreate ({ leadId, enrollmentId, catProvider, paymentType, amount, currency, paymentUrl, notes, advisorObservation, expirationDate, catPaymentChannel, inscriptionData, userId }) {
  const status = paymentUrl ? 'link_sent' : 'pending'
  const requestedBy = paymentUrl ? null : userId
  const createdBy = paymentUrl ? userId : null

  const { rows } = await pool.query(`
    INSERT INTO payment_tokens
      (lead_id, enrollment_id, cat_provider, payment_type, amount, currency, payment_url, status, requested_by, created_by, notes, advisor_observation, expiration_date, cat_payment_channel, inscription_data, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
    RETURNING token_id
  `, [leadId, enrollmentId || null, catProvider || null, paymentType || null, amount, currency || 'USD', paymentUrl || null, status, requestedBy, createdBy, notes || null, advisorObservation || null, expirationDate || null, catPaymentChannel || null, inscriptionData ? JSON.stringify(inscriptionData) : null])

  try {
    const { rows: leadInfo } = await pool.query(`
      SELECT l.full_name AS student_name, pv.abbreviation AS program_name,
             pe.global_code AS edition_code, pe.start_date AS edition_start_date, u.alias AS advisor_alias
      FROM leads l
      LEFT JOIN program_versions pv ON pv.program_version_id = l.program_version_id
      LEFT JOIN program_editions pe ON pe.edition_num_id = l.program_edition_id
      LEFT JOIN users u ON u.user_id = $2
      WHERE l.lead_id = $1
    `, [leadId, userId])
    const info = leadInfo?.[0]
    if (info) {
      // Espejo de la logica del frontend (LeadsNew.vue:3288): cuando la inscripcion
      // va en cuotas, el `amount` ya viene siendo solo la inicial. Slack debe
      // explicitar esa distincion para que quien lee el canal no confunda
      // "S/150 al contado" con "S/150 inicial de un plan de S/600".
      const isInstallment = inscriptionData?.inscription?.cat_type_payment === 'we_payment_way_installments'
      await slackClient.notifyTokenCreated({
        studentName: inscriptionFullName(inscriptionData) || info.student_name,
        programName: info.program_name,
        editionCode: info.edition_code
          ? `${info.edition_code} (${info.edition_start_date ? new Date(info.edition_start_date).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' }) : ''})`
          : '',
        paymentType: paymentType,
        amount, currency,
        isInstallment,
        notes: advisorObservation || notes,
        requestedByName: info.advisor_alias
      })
    }
  } catch (slackErr) { console.error('[tokenCreate] Slack:', slackErr.message) }

  return rows[0]
}


async function tokenUpdate ({ tokenId, paymentUrl, providerReference, notes, expirationDate, catProvider, amount, userId }) {
  const current = await pool.query('SELECT * FROM payment_tokens WHERE token_id = $1', [tokenId])
  if (!current.rows.length) throw new Error('Token no encontrado')

  const token = current.rows[0]
  const sets = []
  const params = []
  let idx = 1

  if (paymentUrl !== undefined) {
    sets.push(`payment_url = $${idx++}`)
    params.push(paymentUrl)
    if (!token.payment_url && paymentUrl) {
      sets.push(`status = $${idx++}`)
      params.push('link_sent')
      sets.push(`created_by = $${idx++}`)
      params.push(userId)
    }
  }

  if (providerReference !== undefined) {
    sets.push(`provider_reference = $${idx++}`)
    params.push(providerReference)
  }

  if (notes !== undefined) {
    sets.push(`notes = $${idx++}`)
    params.push(notes)
  }

  if (expirationDate !== undefined) {
    sets.push(`expiration_date = $${idx++}`)
    params.push(expirationDate)
  }

  if (catProvider !== undefined) {
    sets.push(`cat_provider = $${idx++}`)
    params.push(catProvider)
  }

  if (amount !== undefined) {
    sets.push(`amount = $${idx++}`)
    params.push(amount)
  }

  if (!sets.length) throw new Error('No hay campos para actualizar')

  sets.push(`updated_at = NOW()`)
  params.push(tokenId)

  const isAddingLink   = !token.payment_url && paymentUrl
  const isLinkChanging = paymentUrl !== undefined && paymentUrl !== token.payment_url

  const { rows } = await pool.query(`
    UPDATE payment_tokens SET ${sets.join(', ')} WHERE token_id = $${idx} RETURNING *
  `, params)

  if (isLinkChanging && rows[0]?.group_id) {
    await pool.query(`
      UPDATE payment_tokens
      SET payment_url     = $1,
          status          = CASE WHEN status = 'pending' THEN 'link_sent' ELSE status END,
          created_by      = COALESCE(created_by, $2),
          cat_provider    = COALESCE($3, cat_provider),
          expiration_date = COALESCE($4, expiration_date),
          updated_at      = NOW()
      WHERE group_id = $5 AND token_id <> $6
    `, [paymentUrl, userId, catProvider ?? null, expirationDate ?? null, rows[0].group_id, tokenId])
  }

  if (isLinkChanging) {
    const action      = isAddingLink ? 'token_link_added' : 'token_link_edited'
    const affectedIds = rows[0]?.group_id
      ? (await pool.query('SELECT token_id FROM payment_tokens WHERE group_id = $1', [rows[0].group_id])).rows.map(r => r.token_id)
      : [tokenId]
    await logTokenEvent({
      tokenIds: affectedIds,
      action,
      userId,
      details: `${isAddingLink ? 'Link colocado' : 'Link editado'}: ${paymentUrl}`
    })
  }

  if (isAddingLink && rows[0]) {
    try {
      const groupId     = rows[0].group_id
      const useGroup    = !!groupId
      const whereClause = useGroup ? 'pt.group_id = $1' : 'pt.token_id = $1'
      const firstParam  = useGroup ? groupId : tokenId
      console.log(`[tokenUpdate] Preparando Slack: tokenId=${tokenId} groupId=${groupId || '(sin grupo)'}`)

      const { rows: info } = await pool.query(`
        SELECT
          pt.token_id,
          pt.amount,
          pt.currency,
          pt.inscription_data->'inscription'->>'cat_type_payment' AS cat_type_payment,
          COALESCE(
            NULLIF(TRIM(
              COALESCE(pt.inscription_data->'inscription'->>'full_name','') || ' ' ||
              COALESCE(pt.inscription_data->'inscription'->>'last_name','') || ' ' ||
              COALESCE(pt.inscription_data->'inscription'->>'mother_last_name','')
            ), ''),
            l.full_name
          ) AS student_name,
          pv.abbreviation AS program_name,
          u_req.alias AS advisor_alias,
          u_fico.alias AS fico_alias
        FROM payment_tokens pt
        LEFT JOIN leads l ON l.lead_id = pt.lead_id
        LEFT JOIN program_versions pv ON pv.program_version_id = l.program_version_id
        LEFT JOIN users u_req ON u_req.user_id = pt.requested_by
        LEFT JOIN users u_fico ON u_fico.user_id = $2
        WHERE ${whereClause}
        ORDER BY pt.token_id ASC
      `, [firstParam, userId])

      console.log(`[tokenUpdate] Slack query obtuvo ${info.length} filas`)

      if (info.length) {
        const students = info.map(r => ({
          name:          r.student_name || '---',
          programName:   r.program_name || '---',
          amount:        Number(r.amount),
          currency:      r.currency,
          isInstallment: r.cat_type_payment === 'we_payment_way_installments'
        }))
        const total = students.reduce((s, x) => s + x.amount, 0)
        await slackClient.notifyTokenLinkAdded({
          students,
          groupTotal:    total,
          currency:      students[0].currency,
          advisorName:   info[0].advisor_alias,
          createdByName: info[0].fico_alias,
          paymentUrl
        })
        console.log(`[tokenUpdate] Slack enviado con ${students.length} estudiante(s)`)
      } else {
        console.warn('[tokenUpdate] Slack no enviado: query retorno 0 filas')
      }
    } catch (slackErr) {
      console.error('[tokenUpdate] Slack error:', slackErr.message)
      console.error(slackErr.stack)
    }
  } else {
    console.log(`[tokenUpdate] Slack omitido: isAddingLink=${isAddingLink} hasRows=${!!rows[0]}`)
  }

  return rows[0]
}


async function tokenConfirm ({ tokenId, providerReference, userId }) {
  const { rows } = await pool.query('SELECT * FROM payment_tokens WHERE token_id = $1', [tokenId])
  const token = rows?.[0]
  if (!token) throw new Error('Token no encontrado')
  if (token.status === 'confirmed') throw new Error('Token ya confirmado')

  let enrollmentId = token.enrollment_id

  if (!enrollmentId && token.lead_id) {
    const { rows: existingEnroll } = await pool.query(
      'SELECT e.enrollment_id FROM enrollments e JOIN leads l ON l.enrollment_id = e.enrollment_id WHERE l.lead_id = $1 LIMIT 1',
      [token.lead_id]
    )
    if (existingEnroll?.[0]?.enrollment_id) {
      enrollmentId = existingEnroll[0].enrollment_id
    } else {
      const { rows: statusRows } = await pool.query(
        "SELECT catalog_id FROM catalog WHERE alias = 'we_lead_status_bought' LIMIT 1"
      )

      const inscPayload = token.inscription_data || {}
      if (inscPayload.inscription && token.cat_provider) {
        inscPayload.inscription.cat_token_provider = token.cat_provider
      }
      // pay_date del lead = fecha que el asesor capturo al armar la inscripcion.
      // Caer a CURRENT_DATE solo si el payload no la trae (tokens antiguos sin payment_date).
      const userPayDate = inscPayload?.inscription?.payment_date || null
      await pool.query(
        "UPDATE leads SET pay_date = COALESCE($4::date, CURRENT_DATE), cat_status_lead = COALESCE($3, cat_status_lead), user_modification_id = $2 WHERE lead_id = $1 AND enrollment_id IS NULL",
        [token.lead_id, userId || 9, statusRows?.[0]?.catalog_id || null, userPayDate]
      )
      const enrollRows = await callProcedureReturningRows(
        pool,
        'public.sp_comercial_enrollment_register',
        [token.lead_id, userId || 9, JSON.stringify(inscPayload)],
        { statementTimeoutMs: 25000 }
      )
      const enrollResp = enrollRows?.[0]
      if (enrollResp?.result !== 1 || !enrollResp?.enrollment_id) {
        throw new Error(enrollResp?.message || 'Error al crear inscripcion desde token')
      }
      enrollmentId = enrollResp.enrollment_id

      const insc = inscPayload.inscription || {}
      const plan = insc.installment_plan
      const adelanto = Number(insc.saved_money) || 0
      const isInstallments = plan && Array.isArray(plan) && plan.length > 0 && adelanto > 0

      if (isInstallments) {
        await pool.query('DELETE FROM payments WHERE enrollment_id = $1', [enrollmentId])
        await pool.query('DELETE FROM payment_installments WHERE enrollment_id = $1', [enrollmentId])

        const catDraft = 3174
        await pool.query(
          'INSERT INTO payment_installments (enrollment_id, installment_number, amount, due_date, cat_status) VALUES ($1, 0, $2, CURRENT_DATE, $3)',
          [enrollmentId, adelanto, catDraft]
        )
        for (const cuota of plan) {
          await pool.query(
            'INSERT INTO payment_installments (enrollment_id, installment_number, amount, due_date, cat_status) VALUES ($1, $2, $3, $4, $5)',
            [enrollmentId, cuota.installment_number, Number(cuota.amount), cuota.due_date || null, catDraft]
          )
        }

        const catInstallments = 2467
        await pool.query(
          'UPDATE enrollments SET cat_payment_plan = $1 WHERE enrollment_id = $2',
          [catInstallments, enrollmentId]
        )
      }

      const vals = inscPayload.validations
      if (vals?.enabled && vals.validated_children?.length > 0) {
        try {
          for (const childId of vals.validated_children) {
            const customEdId = vals.custom_editions?.[String(childId)] || null
            await pool.query(`
              INSERT INTO enrollment_validations (enrollment_id, child_version_id, validation_type, custom_edition_id, notes, status, requested_by)
              VALUES ($1, $2, $3, $4, $5, 'pending', $6)
            `, [enrollmentId, childId, customEdId ? 'cross_edition' : 'same_edition', customEdId, vals.notes || null, userId])
          }
          await pool.query(`
            INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, details)
            VALUES ($1, 'validation_requested', $2, $3)
          `, [enrollmentId, userId, `Convalidacion solicitada desde token: ${vals.validated_children.length} modulo(s). ${vals.notes || ''}`])
        } catch (e) {
          console.error('[tokenConfirm] Error guardando convalidaciones:', e.message)
        }
      }
    }
  }

  await pool.query(`
    UPDATE payment_tokens
    SET enrollment_id = $1, updated_at = NOW()
    WHERE token_id = $2
  `, [enrollmentId, tokenId])

  if (enrollmentId) {
    const { rows: provRows } = await pool.query(
      'SELECT description FROM catalog WHERE catalog_id = $1', [token.cat_provider]
    )
    const provName = provRows?.[0]?.description || '---'
    const { rows: reqUser } = await pool.query(
      'SELECT name FROM users WHERE user_id = $1', [token.requested_by || token.created_by]
    )
    const reqName = reqUser?.[0]?.name || '---'

    try {
      await pool.query(`
        UPDATE enrollment_audit_log SET enrollment_id = $1 WHERE token_id = $2
      `, [enrollmentId, token.token_id])

      await pool.query(`
        INSERT INTO enrollment_audit_log (enrollment_id, token_id, action, performed_by, details)
        VALUES ($1, $2, 'created_from_token', $3, $4)
      `, [
        enrollmentId,
        token.token_id,
        userId,
        `Inscripcion creada desde token de pago | Proveedor: ${provName} | Monto: ${token.currency || 'PEN'} ${token.amount} | Link: ${token.payment_url || '---'} | Solicitado por: ${reqName}`
      ])
    } catch (e) { console.error('[tokenConfirm] Audit error:', e.message) }
  }

  return { result: 1, message: 'Inscripcion creada', enrollment_id: enrollmentId }
}


async function tokenMarkPaid ({ tokenId, providerReference, userId }) {
  const { rows } = await pool.query(`
    UPDATE payment_tokens
    SET status = 'paid',
        provider_reference = $1,
        updated_at = NOW()
    WHERE token_id = $2
    RETURNING *
  `, [providerReference || null, tokenId])

  if (!rows.length) throw new Error('Token no encontrado')
  return rows[0]
}


async function tokenDelete ({ tokenId }) {
  const current = await pool.query('SELECT status FROM payment_tokens WHERE token_id = $1', [tokenId])
  if (!current.rows.length) throw new Error('Token no encontrado')
  if (current.rows[0].status !== 'pending') throw new Error('Solo se pueden eliminar tokens en estado pending')

  await pool.query('DELETE FROM payment_tokens WHERE token_id = $1', [tokenId])
  return { deleted: true }
}


async function tokenGroup ({ tokenIds, userId }) {
  if (!Array.isArray(tokenIds) || tokenIds.length < 2) {
    throw new Error('Selecciona al menos 2 tokens para agrupar')
  }
  if (tokenIds.length > MAX_TOKENS_PER_GROUP) {
    throw new Error(`Maximo ${MAX_TOKENS_PER_GROUP} tokens por grupo`)
  }

  const { rows } = await pool.query(
    `SELECT token_id, status, payment_url, requested_by, currency, cat_provider, payment_type, amount, group_id
     FROM payment_tokens WHERE token_id = ANY($1::int[])`,
    [tokenIds]
  )

  if (rows.length !== tokenIds.length) throw new Error('Uno o mas tokens no existen')
  if (rows.some(t => t.requested_by !== userId)) throw new Error('Solo puedes agrupar tus propios tokens')
  if (rows.some(t => t.status !== 'pending' || t.payment_url || t.group_id)) {
    throw new Error('Solo tokens pendientes sin link y sin grupo previo pueden agruparse')
  }

  const uniq = (field) => new Set(rows.map(t => t[field])).size === 1
  if (!uniq('currency'))     throw new Error('Los tokens deben tener la misma moneda')
  if (!uniq('cat_provider')) throw new Error('Los tokens deben tener el mismo proveedor')
  if (!uniq('payment_type')) throw new Error('Los tokens deben tener el mismo tipo de pago (credito / debito)')

  const total = rows.reduce((s, t) => s + Number(t.amount || 0), 0)
  if (total > MAX_GROUP_AMOUNT) {
    throw new Error(`El total del grupo (${rows[0].currency} ${total.toFixed(2)}) supera el limite permitido de ${MAX_GROUP_AMOUNT}`)
  }

  const groupId = crypto.randomUUID()
  await pool.query(
    'UPDATE payment_tokens SET group_id = $1, updated_at = NOW() WHERE token_id = ANY($2::int[])',
    [groupId, tokenIds]
  )

  await logTokenEvent({
    tokenIds,
    action:  'token_grouped',
    userId,
    details: `Agrupado en grupo ${groupId.slice(0, 4).toUpperCase()} con ${rows.length} tokens, total ${rows[0].currency} ${rows.reduce((s, t) => s + Number(t.amount || 0), 0).toFixed(2)}`
  })

  return { group_id: groupId, token_count: rows.length }
}


async function tokenEditInscription ({ tokenId, inscription, amount, currency, paymentType, catPaymentChannel, advisorObservation, userId }) {
  const { rows } = await pool.query(
    'SELECT * FROM payment_tokens WHERE token_id = $1',
    [tokenId]
  )
  const t = rows[0]
  if (!t) throw new Error('Token no encontrado')
  if (Number(t.requested_by) !== Number(userId)) {
    throw new Error('Solo el asesor que solicito el token puede editar la inscripcion')
  }
  if (t.status === 'confirmed') {
    throw new Error('No se puede editar: la inscripcion ya fue creada. Usar el flujo de edicion en el detalle del enrollment.')
  }
  if (t.status === 'paid') {
    throw new Error('No se puede editar: el cliente ya pago. El ajuste debe hacerlo FICO desde la inscripcion.')
  }

  const currentInsc = t.inscription_data?.inscription || {}
  const changes = {}

  for (const f of Object.keys(inscription || {})) {
    const oldVal = currentInsc[f]
    const newVal = inscription[f]
    if (String(oldVal ?? '') !== String(newVal ?? '')) {
      changes[f] = { old: oldVal ?? null, new: newVal ?? null }
    }
  }

  const topLevelDiff = (colName, newVal) => {
    if (newVal === undefined) return
    if (String(t[colName] ?? '') !== String(newVal ?? '')) {
      changes[colName] = { old: t[colName] ?? null, new: newVal ?? null }
    }
  }
  topLevelDiff('amount',              amount)
  topLevelDiff('currency',            currency)
  topLevelDiff('payment_type',        paymentType)
  topLevelDiff('cat_payment_channel', catPaymentChannel)
  topLevelDiff('advisor_observation', advisorObservation)

  if (!Object.keys(changes).length) return { ok: true, updated_fields: [], message: 'Sin cambios' }

  const merged  = { ...currentInsc, ...inscription }
  const newData = { ...(t.inscription_data || {}), inscription: merged }

  const sets   = ['inscription_data = $1::jsonb']
  const params = [JSON.stringify(newData)]
  let idx = 2
  const addSet = (col, val) => {
    if (val === undefined) return
    sets.push(`${col} = $${idx++}`)
    params.push(val)
  }
  addSet('amount',              amount)
  addSet('currency',            currency)
  addSet('payment_type',        paymentType)
  addSet('cat_payment_channel', catPaymentChannel)
  addSet('advisor_observation', advisorObservation)
  sets.push('updated_at = NOW()')
  params.push(tokenId)

  await pool.query(
    `UPDATE payment_tokens SET ${sets.join(', ')} WHERE token_id = $${idx}`,
    params
  )

  await logTokenEvent({
    tokenId,
    action:  'token_inscription_edited',
    userId,
    details: `Asesor edito campos: ${Object.keys(changes).join(', ')}`,
    changes
  })

  return { ok: true, updated_fields: Object.keys(changes) }
}


async function tokenUngroup ({ groupId, userId }) {
  const { rows } = await pool.query(
    'SELECT token_id, status, requested_by FROM payment_tokens WHERE group_id = $1',
    [groupId]
  )
  if (!rows.length) throw new Error('Grupo no encontrado')
  if (rows.some(t => t.requested_by !== userId)) {
    throw new Error('Solo el asesor dueno del grupo puede desagruparlo')
  }

  const locked = rows.find(t => t.status === 'paid' || t.status === 'confirmed')
  if (locked) {
    throw new Error(`No se puede desagrupar: hay tokens en estado "${locked.status}". Los pagos o inscripciones ya registrados no pueden revertirse.`)
  }

  const tokenIds = rows.map(r => r.token_id)
  await logTokenEvent({
    tokenIds,
    action:  'token_ungrouped',
    userId,
    details: `Desagrupado del grupo ${groupId.slice(0, 4).toUpperCase()}. Link compartido borrado y token vuelve a pendiente.`
  })

  await pool.query(`
    UPDATE payment_tokens
    SET group_id           = NULL,
        payment_url        = NULL,
        status             = 'pending',
        created_by         = NULL,
        provider_reference = NULL,
        updated_at         = NOW()
    WHERE group_id = $1
  `, [groupId])

  return { ungrouped: rows.length }
}


export default {
  tokenList,
  tokenGetById,
  tokenStats,
  tokenCreate,
  tokenUpdate,
  tokenConfirm,
  tokenMarkPaid,
  tokenDelete,
  tokenGroup,
  tokenUngroup,
  tokenEditInscription
}
