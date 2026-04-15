import { pool } from '../config/db.js'
import { callProcedureReturningRows } from '../utils/spHelper.js'

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
    c_prov.description AS provider_name,
    u_req.name AS requested_by_name,
    u_cre.name AS created_by_name,
    u_conf.name AS confirmed_by_name
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
  LEFT JOIN catalog c_prov ON c_prov.catalog_id = pt.cat_provider
  LEFT JOIN users u_req ON u_req.user_id = pt.requested_by
  LEFT JOIN users u_cre ON u_cre.user_id = pt.created_by
  LEFT JOIN users u_conf ON u_conf.user_id = pt.confirmed_by
`

async function tokenList (filters = {}) {
  const conditions = []
  const params = []
  let idx = 1

  if (filters.status) {
    conditions.push(`pt.status = $${idx++}`)
    params.push(filters.status)
  }

  if (filters.provider) {
    conditions.push(`pt.cat_provider = $${idx++}`)
    params.push(Number(filters.provider))
  }

  if (filters.search) {
    conditions.push(`(
      per.first_name || ' ' || per.last_name ILIKE $${idx}
      OR per.document_number ILIKE $${idx}
      OR l_dir.full_name ILIKE $${idx}
    )`)
    params.push(`%${filters.search}%`)
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
    LEFT JOIN leads l_dir ON l_dir.lead_id = pt.lead_id
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


async function tokenCreate ({ leadId, enrollmentId, catProvider, amount, currency, paymentUrl, notes, expirationDate, catPaymentChannel, inscriptionData, userId }) {
  const status = paymentUrl ? 'link_sent' : 'pending'
  const requestedBy = paymentUrl ? null : userId
  const createdBy = paymentUrl ? userId : null

  const { rows } = await pool.query(`
    INSERT INTO payment_tokens
      (lead_id, enrollment_id, cat_provider, amount, currency, payment_url, status, requested_by, created_by, notes, expiration_date, cat_payment_channel, inscription_data, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
    RETURNING token_id
  `, [leadId, enrollmentId || null, catProvider, amount, currency || 'USD', paymentUrl || null, status, requestedBy, createdBy, notes || null, expirationDate || null, catPaymentChannel || null, inscriptionData ? JSON.stringify(inscriptionData) : null])

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

  const { rows } = await pool.query(`
    UPDATE payment_tokens SET ${sets.join(', ')} WHERE token_id = $${idx} RETURNING *
  `, params)

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
      await pool.query(
        "UPDATE leads SET pay_date = CURRENT_DATE, cat_status_lead = COALESCE($3, cat_status_lead), user_modification_id = $2 WHERE lead_id = $1 AND enrollment_id IS NULL",
        [token.lead_id, userId || 9, statusRows?.[0]?.catalog_id || null]
      )

      const inscPayload = token.inscription_data || {}
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
        INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, details)
        VALUES ($1, 'created_from_token', $2, $3)
      `, [
        enrollmentId,
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


export default {
  tokenList,
  tokenCreate,
  tokenUpdate,
  tokenConfirm,
  tokenMarkPaid,
  tokenDelete
}
