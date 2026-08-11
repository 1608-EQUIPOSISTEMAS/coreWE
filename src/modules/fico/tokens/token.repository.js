import { pool } from '../../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../../shared/db/sp.js'
import { saveLooseInscriptionFields } from '../../../utils/inscription-loose-fields.js'

// Aliases de situacion del lead que marcan canal B2B. Cualquiera de los dos
// activa el prefijo 'B2B - ' en los nombres de asesor del token y el flag is_b2b.
// Legacy 'we_prospect_situation_corporate' y nuevo 'we_prospect_situation_convenios'.
const B2B_SITUATION_ALIASES = "('we_prospect_situation_corporate','we_prospect_situation_convenios')"

const BASE_SELECT = `
  SELECT pt.*,
    CASE WHEN e.enrollment_id IS NOT NULL
      THEN TRIM(BOTH FROM concat_ws(' ', per.first_name, per.last_name, per.mother_last_name))
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
    CASE WHEN COALESCE(c_sit.alias, c_sit_dir.alias) IN ${B2B_SITUATION_ALIASES} AND u_req.alias IS NOT NULL
         THEN 'B2B - ' || u_req.alias
         ELSE u_req.alias
    END AS requested_by_name,
    CASE WHEN COALESCE(c_sit.alias, c_sit_dir.alias) IN ${B2B_SITUATION_ALIASES} AND u_cre.alias IS NOT NULL
         THEN 'B2B - ' || u_cre.alias
         ELSE u_cre.alias
    END AS created_by_name,
    u_conf.alias AS confirmed_by_name,
    (COALESCE(c_sit.alias, c_sit_dir.alias) IN ${B2B_SITUATION_ALIASES}) AS is_b2b
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

// Persistencia de payment_tokens. Envuelve pool.query y los SPs; no contiene
// reglas de negocio (esas viven en token.entity.js) ni notificaciones.
export class TokenRepository {
  constructor (db = pool, sp = callProcedureReturningRows) {
    this.db = db
    this.sp = sp
  }

  async list (filters = {}) {
    const conditions = []
    const params = []
    let idx = 1

    const toArray = v => {
      if (v == null || v === '') return []
      if (Array.isArray(v)) return v.filter(x => x != null && x !== '')
      return String(v).split(',').map(s => s.trim()).filter(Boolean)
    }

    if (filters.status) {
      conditions.push(`pt.status = $${idx++}`)
      params.push(filters.status)
    }

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

    const q = filters.q || filters.search
    if (q) {
      conditions.push(`(
        concat_ws(' ', per.first_name, per.last_name, per.mother_last_name) ILIKE $${idx}
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
      this.db.query(countQuery, params.slice(0, params.length - 2)),
      this.db.query(dataQuery, params)
    ])

    return {
      total: Number(countRes.rows[0]?.total ?? 0),
      page,
      size,
      items: dataRes.rows
    }
  }

  async findById (tokenId) {
    const { rows } = await this.db.query(`
      ${BASE_SELECT}
      WHERE pt.token_id = $1
    `, [tokenId])
    return rows[0] || null
  }

  async findRawById (tokenId) {
    const { rows } = await this.db.query('SELECT * FROM payment_tokens WHERE token_id = $1', [tokenId])
    return rows[0] || null
  }

  async stats () {
    const { rows } = await this.db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')   AS pending_count,
        COUNT(*) FILTER (WHERE status = 'link_sent') AS link_sent_count,
        COUNT(*) FILTER (WHERE status = 'confirmed' AND updated_at::date = CURRENT_DATE) AS confirmed_today_count,
        COALESCE(SUM(amount) FILTER (WHERE status IN ('pending','link_sent') AND currency = 'PEN'), 0) AS amount_pen,
        COALESCE(SUM(amount) FILTER (WHERE status IN ('pending','link_sent') AND currency = 'USD'), 0) AS amount_usd
      FROM payment_tokens
    `)
    return rows[0] || {}
  }

  async insert (token) {
    const { rows } = await this.db.query(`
      INSERT INTO payment_tokens
        (lead_id, enrollment_id, cat_provider, payment_type, amount, currency, payment_url, status, requested_by, created_by, notes, advisor_observation, expiration_date, cat_payment_channel, inscription_data, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
      RETURNING token_id
    `, [
      token.leadId, token.enrollmentId || null, token.catProvider || null, token.paymentType || null,
      token.amount, token.currency || 'USD', token.paymentUrl || null, token.status,
      token.requestedBy, token.createdBy, token.notes || null, token.advisorObservation || null,
      token.expirationDate || null, token.catPaymentChannel || null,
      token.inscriptionData ? JSON.stringify(token.inscriptionData) : null
    ])
    return rows[0]
  }

  async findLeadInfoForCreateNotice (leadId, userId) {
    const { rows } = await this.db.query(`
      SELECT l.full_name AS student_name, pv.abbreviation AS program_name,
             pe.global_code AS edition_code, pe.start_date AS edition_start_date, u.alias AS advisor_alias
      FROM leads l
      LEFT JOIN program_versions pv ON pv.program_version_id = l.program_version_id
      LEFT JOIN program_editions pe ON pe.edition_num_id = l.program_edition_id
      LEFT JOIN users u ON u.user_id = $2
      WHERE l.lead_id = $1
    `, [leadId, userId])
    return rows[0] || null
  }

  async updateDynamic (tokenId, sets, params) {
    const { rows } = await this.db.query(`
      UPDATE payment_tokens SET ${sets.join(', ')} WHERE token_id = $${params.length} RETURNING *
    `, params)
    return rows[0] || null
  }

  async propagateLinkToGroup ({ paymentUrl, userId, catProvider, expirationDate, groupId, excludeTokenId }) {
    await this.db.query(`
      UPDATE payment_tokens
      SET payment_url     = $1,
          status          = CASE WHEN status = 'pending' THEN 'link_sent' ELSE status END,
          created_by      = COALESCE(created_by, $2),
          cat_provider    = COALESCE($3, cat_provider),
          expiration_date = COALESCE($4, expiration_date),
          updated_at      = NOW()
      WHERE group_id = $5 AND token_id <> $6
    `, [paymentUrl, userId, catProvider ?? null, expirationDate ?? null, groupId, excludeTokenId])
  }

  async findGroupTokenIds (groupId) {
    const { rows } = await this.db.query('SELECT token_id FROM payment_tokens WHERE group_id = $1', [groupId])
    return rows.map(r => r.token_id)
  }

  async findLinkNotice ({ groupId, tokenId, userId }) {
    const useGroup = !!groupId
    const whereClause = useGroup ? 'pt.group_id = $1' : 'pt.token_id = $1'
    const firstParam = useGroup ? groupId : tokenId
    const { rows } = await this.db.query(`
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
    return rows
  }

  async findEnrollmentIdByLead (leadId) {
    const { rows } = await this.db.query(
      'SELECT e.enrollment_id FROM enrollments e JOIN leads l ON l.enrollment_id = e.enrollment_id WHERE l.lead_id = $1 LIMIT 1',
      [leadId]
    )
    return rows[0]?.enrollment_id || null
  }

  async findCatalogIdByAlias (alias) {
    const { rows } = await this.db.query('SELECT catalog_id FROM catalog WHERE alias = $1 LIMIT 1', [alias])
    return rows[0]?.catalog_id || null
  }

  async prepareLeadForEnrollment ({ leadId, userId, statusCatId, payDate }) {
    await this.db.query(
      "UPDATE leads SET pay_date = COALESCE($4::date, CURRENT_DATE), cat_status_lead = COALESCE($3, cat_status_lead), user_modification_id = $2 WHERE lead_id = $1 AND enrollment_id IS NULL",
      [leadId, userId || 9, statusCatId || null, payDate]
    )
  }

  async registerEnrollment ({ leadId, userId, payload }) {
    const rows = await this.sp(
      pool,
      'public.sp_comercial_enrollment_register',
      [leadId, userId || 9, JSON.stringify(payload)],
      { statementTimeoutMs: 25000 }
    )
    const res = rows?.[0] || null

    // Mismo UPDATE aparte que comercial.repository.enrollmentRegister: el SP no
    // conoce estos campos. Sin esto, un congreso de fundacion vendido por token
    // pierde la categoria de entrada (VIP/GENERAL/PREMIUM) y el correo en copia
    // que pidio el asesor se perderia al confirmarse el token.
    if (res?.result === 1 && res.enrollment_id) {
      await saveLooseInscriptionFields(this.db, res.enrollment_id, payload?.inscription || {})
    }
    return res
  }

  async replaceInstallments ({ enrollmentId, adelanto, plan, catDraft }) {
    await this.db.query('DELETE FROM payments WHERE enrollment_id = $1', [enrollmentId])
    await this.db.query('DELETE FROM payment_installments WHERE enrollment_id = $1', [enrollmentId])
    await this.db.query(
      'INSERT INTO payment_installments (enrollment_id, installment_number, amount, due_date, cat_status) VALUES ($1, 0, $2, CURRENT_DATE, $3)',
      [enrollmentId, adelanto, catDraft]
    )
    for (const cuota of plan) {
      await this.db.query(
        'INSERT INTO payment_installments (enrollment_id, installment_number, amount, due_date, cat_status) VALUES ($1, $2, $3, $4, $5)',
        [enrollmentId, cuota.installment_number, Number(cuota.amount), cuota.due_date || null, catDraft]
      )
    }
  }

  async setPaymentPlan (enrollmentId, catPaymentPlan) {
    await this.db.query('UPDATE enrollments SET cat_payment_plan = $1 WHERE enrollment_id = $2', [catPaymentPlan, enrollmentId])
  }

  // Las filas ya vienen clasificadas por buildValidationRows (entity): aqui solo
  // se persisten.
  async insertValidations ({ enrollmentId, rows, notes, userId }) {
    for (const row of rows) {
      await this.db.query(`
        INSERT INTO enrollment_validations (enrollment_id, child_version_id, validation_type, custom_edition_id, notes, status, requested_by)
        VALUES ($1, $2, $3, $4, $5, 'pending', $6)
      `, [enrollmentId, row.childVersionId, row.validationType, row.customEditionId, notes || null, userId])
    }
    await this.db.query(`
      INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, details)
      VALUES ($1, 'validation_requested', $2, $3)
    `, [enrollmentId, userId, `Convalidacion solicitada desde token: ${rows.length} modulo(s). ${notes || ''}`])
  }

  async linkTokenToEnrollment (tokenId, enrollmentId) {
    await this.db.query(`
      UPDATE payment_tokens
      SET enrollment_id = $1, updated_at = NOW()
      WHERE token_id = $2
    `, [enrollmentId, tokenId])
  }

  async findProviderDescription (catProvider) {
    const { rows } = await this.db.query('SELECT description FROM catalog WHERE catalog_id = $1', [catProvider])
    return rows[0]?.description || '---'
  }

  async findUserName (userId) {
    const { rows } = await this.db.query('SELECT name FROM users WHERE user_id = $1', [userId])
    return rows[0]?.name || '---'
  }

  async reassignAuditLogToEnrollment (tokenId, enrollmentId) {
    await this.db.query('UPDATE enrollment_audit_log SET enrollment_id = $1 WHERE token_id = $2', [enrollmentId, tokenId])
  }

  async insertCreatedFromTokenAudit ({ enrollmentId, tokenId, userId, details }) {
    await this.db.query(`
      INSERT INTO enrollment_audit_log (enrollment_id, token_id, action, performed_by, details)
      VALUES ($1, $2, 'created_from_token', $3, $4)
    `, [enrollmentId, tokenId, userId, details])
  }

  async markPaid ({ tokenId, providerReference }) {
    const { rows } = await this.db.query(`
      UPDATE payment_tokens
      SET status = 'paid',
          provider_reference = $1,
          updated_at = NOW()
      WHERE token_id = $2
      RETURNING *
    `, [providerReference || null, tokenId])
    return rows[0] || null
  }

  async findStatusById (tokenId) {
    const { rows } = await this.db.query('SELECT status FROM payment_tokens WHERE token_id = $1', [tokenId])
    return rows[0] || null
  }

  async delete (tokenId) {
    await this.db.query('DELETE FROM payment_tokens WHERE token_id = $1', [tokenId])
  }

  async findGroupCandidates (tokenIds) {
    const { rows } = await this.db.query(
      `SELECT token_id, status, payment_url, requested_by, currency, cat_provider, payment_type, amount, group_id
       FROM payment_tokens WHERE token_id = ANY($1::int[])`,
      [tokenIds]
    )
    return rows
  }

  async assignGroup ({ groupId, tokenIds }) {
    await this.db.query(
      'UPDATE payment_tokens SET group_id = $1, updated_at = NOW() WHERE token_id = ANY($2::int[])',
      [groupId, tokenIds]
    )
  }

  async findGroupForUngroup (groupId) {
    const { rows } = await this.db.query(
      'SELECT token_id, status, requested_by FROM payment_tokens WHERE group_id = $1',
      [groupId]
    )
    return rows
  }

  async clearGroup (groupId) {
    await this.db.query(`
      UPDATE payment_tokens
      SET group_id           = NULL,
          payment_url        = NULL,
          status             = 'pending',
          created_by         = NULL,
          provider_reference = NULL,
          updated_at         = NOW()
      WHERE group_id = $1
    `, [groupId])
  }

  async updateInscription ({ tokenId, sets, params }) {
    await this.db.query(
      `UPDATE payment_tokens SET ${sets.join(', ')} WHERE token_id = $${params.length}`,
      params
    )
  }

  async logEvent ({ tokenId, tokenIds, action, userId, details = null, changes = null }) {
    const ids = Array.isArray(tokenIds) ? tokenIds : [tokenId]
    const changesJson = changes ? JSON.stringify(changes) : null
    for (const id of ids) {
      await this.db.query(`
        INSERT INTO enrollment_audit_log (token_id, action, performed_by, details, changes)
        VALUES ($1, $2, $3, $4, $5::jsonb)
      `, [id, action, userId || null, details, changesJson])
    }
  }
}

export const tokenRepository = new TokenRepository()
