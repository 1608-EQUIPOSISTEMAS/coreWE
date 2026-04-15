import { pool } from '../config/db.js'
import { callProcedureReturningRows } from '../utils/spHelper.js'
import odooClient from '../config/odooClient.js'
import { sendEmail, sendFicoEmail } from '../config/zeptomail.js'
import { buildConfirmacionHTML } from '../templates/confirmacion-inscripcion.js'
import { buildConfirmacionPagoHTML } from '../templates/confirmacion-pago.js'
import { buildActivacionHTML } from '../templates/activacion-cursos.js'
import { buildMembresiaHTML, detectMembershipType } from '../templates/bienvenida-membresia.js'
import slackClient from '../config/slack.js'

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

  return rows?.[0] || null
}


async function confirmPayment (payload) {
  const { rows } = await pool.query(
    'SELECT * FROM public.sp_fico_confirm_payment($1::jsonb)',
    [JSON.stringify(payload)]
  )
  const resp = rows?.[0] || { result: 0, message: 'Sin respuesta' }

  if (resp.result === 1 && payload.enrollment_id) {
    await logAudit({
      enrollmentId: payload.enrollment_id,
      action: 'approved',
      userId: payload.user_id,
      details: `Pago confirmado: ${payload.action || ''}`
    })

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
  }

  return resp
}

async function createChildEnrollments ({ enrollmentId, userId }) {
  const { rows: parentData } = await pool.query(`
    SELECT e.enrollment_id, e.customer_id, e.program_version_id, e.program_edition_id,
           e.cat_currency, e.cat_inscription_modality, e.cat_payment_channel, e.cat_payment_plan,
           e.cat_profile_id, e.seller_agent_id,
           per.first_name, per.last_name, per.document_number, per.cat_type_document,
           l.origin_email, l.origin_phone, l.cat_code_country,
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
  if (!parent) { console.log('[childEnrollments] No se encontro enrollment padre'); return }
  console.log('[childEnrollments] Enrollment padre:', enrollmentId, 'pvId:', parent.program_version_id, 'edId:', parent.program_edition_id)

  const { rows: structRows } = await pool.query(`
    SELECT child_program_version_id, sort_order
    FROM program_version_structure
    WHERE parent_program_version_id = $1
    ORDER BY sort_order
  `, [parent.program_version_id])

  const childrenIds = (structRows || []).map(r => r.child_program_version_id).filter(Boolean)
  console.log('[childEnrollments] childrenIds:', JSON.stringify(childrenIds))
  if (childrenIds.length === 0) { console.log('[childEnrollments] Sin hijos, saliendo'); return }

  const treeRows = await callProcedureReturningRows(
    pool,
    'public.sp_edition_tree_get',
    [parent.program_edition_id],
    { statementTimeoutMs: 15000 }
  ).catch(() => [])

  const treeData = treeRows?.[0]
  const treeChildren = treeData?.children
  console.log('[childEnrollments] treeChildren:', JSON.stringify(treeChildren?.map(c => ({ pvId: c.child_program_version_id, edId: c.edition_id || c.edition_num_id, code: c.global_code }))))
  if (!treeChildren || !Array.isArray(treeChildren) || treeChildren.length === 0) { console.log('[childEnrollments] Sin ediciones hijas en el arbol, saliendo'); return }

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

  const { rows: certCat } = await pool.query(
    `SELECT catalog_id FROM catalog WHERE alias = 'we_certificate_status_paid' LIMIT 1`
  )
  const { rows: contadoCat } = await pool.query(
    `SELECT catalog_id FROM catalog WHERE alias = 'we_payment_way_single' LIMIT 1`
  )
  const { rows: defaultMethod } = await pool.query(
    `SELECT catalog_id FROM catalog WHERE alias = 'we_payment_method_transfer' LIMIT 1`
  )
  const { rows: segCat } = await pool.query(
    `SELECT catalog_id FROM catalog WHERE alias = 'we_enrollment_status_tracking' LIMIT 1`
  )
  const { rows: parentAttachments } = await pool.query(
    `SELECT file_url AS url, file_url AS name FROM enrollment_attachments WHERE enrollment_id = $1 AND active = 'Y'`,
    [enrollmentId]
  ).catch(() => ({ rows: [] }))

  const createdChildren = []
  const totalChildren = Object.keys(editionMap).length

  const { rows: catChecked } = await pool.query(
    `SELECT catalog_id FROM catalog WHERE alias = 'we_enrollment_status_checked' LIMIT 1`
  )

  const validations = await getValidations({ enrollmentId })
  const validatedVersionIds = validations.map(v => v.child_version_id)
  const customEditions = {}
  validations.filter(v => v.custom_edition_id).forEach(v => { customEditions[v.child_version_id] = v.custom_edition_id })

  for (const childPvId of childrenIds) {
    const childInfo = editionMap[childPvId]
    if (!childInfo) continue

    if (validatedVersionIds.includes(childPvId)) {
      console.log(`[childEnrollments] Skipping ${childPvId} - convalidado`)
      continue
    }

    const editionId = customEditions[childPvId] || childInfo.editionId

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
        parent.cat_currency, parent.cat_inscription_modality, parent.cat_payment_channel, contadoCat?.[0]?.catalog_id || parent.cat_payment_plan,
        catChecked?.[0]?.catalog_id || null, segCat?.[0]?.catalog_id || null, certCat?.[0]?.catalog_id || null,
        parent.seller_agent_id, userId || 9,
        `Seguimiento (${childInfo.sortOrder}/${totalChildren}) de ${parent.parent_program_name || ''} ${parent.parent_edition_code || ''}`.trim(),
        parent.cat_profile_id
      ])

      const childEid = newEnroll?.[0]?.enrollment_id
      if (childEid) {
        await logAudit({
          enrollmentId: childEid,
          action: 'created',
          userId,
          details: `Seguimiento ${childInfo.globalCode} (${childInfo.sortOrder}/${totalChildren}) - Modulo de ${parent.parent_program_name || ''} ${parent.parent_edition_code || ''}`
        })
        createdChildren.push({ id: childEid, code: childInfo.globalCode, order: childInfo.sortOrder })
        console.log(`[createChildEnrollments] Hijo creado: enrollment #${childEid} pvId=${childPvId} ${childInfo.globalCode}`)
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
      details: `Seguimiento: ${childList}`
    })
  }

  if (validatedVersionIds.length > 0) {
    await logAudit({
      enrollmentId,
      action: 'validation_applied',
      userId,
      details: `Convalidacion aplicada: ${validatedVersionIds.length} modulo(s) convalidados, ${createdChildren.length} modulo(s) inscritos`
    })
  }
}

function generatePassword (length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let pwd = ''
  for (let i = 0; i < length; i++) pwd += chars[Math.floor(Math.random() * chars.length)]
  return pwd
}

function buildOdooEmail (firstName, lastName) {
  const normalize = s => (s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '').trim()
  const first = normalize(firstName).split(/\s+/)[0] || ''
  const last = normalize(lastName).split(/\s+/)[0] || ''
  return `${last}.${first}@weeducacion.edu.pe`
}

async function enrollInOdoo ({ enrollmentId }) {
  const { rows: chk } = await pool.query(`
    SELECT pv.abbreviation FROM enrollments e
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    WHERE e.enrollment_id = $1
  `, [enrollmentId])
  if (chk?.[0] && isMembership(chk[0].abbreviation)) {
    return enrollMembershipInOdoo({ enrollmentId })
  }

  const { rows } = await pool.query(`
    SELECT e.enrollment_id, e.program_edition_id,
           per.first_name, per.last_name, per.document_number,
           l.origin_email,
           prog.odoo_activation,
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

  const { rows: prevOdoo } = await pool.query(`
    SELECT e.odoo_user_id FROM enrollments e
    JOIN customers c ON c.customer_id = e.customer_id
    JOIN persons p ON p.person_id = c.person_id
    WHERE p.document_number = $1 AND e.odoo_user_id IS NOT NULL
    ORDER BY e.enrollment_id DESC LIMIT 1
  `, [data.document_number])

  let searchEmail = data.origin_email
  if (prevOdoo?.[0]?.odoo_user_id) {
    const existingUser = await odooClient.callKw('res.users', 'read', [
      [prevOdoo[0].odoo_user_id], ['login']
    ]).catch(() => null)
    if (existingUser?.[0]?.login) {
      searchEmail = existingUser[0].login
    }
  }

  const createEmail = buildOdooEmail(data.first_name, data.last_name)
  const fullName = `${(data.last_name || '').trim()} ${(data.first_name || '').trim()}`.trim().toUpperCase()
  const password = generatePassword()

  const startDate = data.start_date
  if (!startDate) throw new Error('La edicion no tiene fecha de inicio')
  const d = new Date(startDate)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const searchName = `${odooActivation} (${dd}/${mm}) - ${monthNames[d.getMonth()]} ${d.getFullYear()}`

  const groups = await odooClient.searchSlideGroup(odooActivation)
  const match = groups.find(g => g.name === searchName)
  if (!match) throw new Error(`Curso no encontrado en Odoo: "${searchName}"`)
  const slideGroupId = match.id

  const result = await odooClient.syncStudentToOdoo({
    searchEmail,
    createEmail,
    fullName,
    password,
    slideGroupId
  })

  if (result.success) {
    await pool.query(`
      UPDATE enrollments SET
        odoo_user_id = $1,
        odoo_student_id = $2,
        odoo_password = $3,
        odoo_email = $5
      WHERE enrollment_id = $4
    `, [result.odoo_user_id, result.odoo_student_id, result.password_set || null, enrollmentId, createEmail])

    try {
      const { rows: instRows } = await pool.query(`
        SELECT installment_number, amount, due_date FROM payment_installments
        WHERE enrollment_id = $1 AND installment_number > 0 ORDER BY installment_number
      `, [enrollmentId])

      const { rows: enrollData } = await pool.query(`
        SELECT e.total_amount, e.discount_amount FROM enrollments e WHERE e.enrollment_id = $1
      `, [enrollmentId])
      const netAmount = (enrollData?.[0]?.total_amount || 0) - (enrollData?.[0]?.discount_amount || 0)

      const orderResult = await odooClient.createSaleOrderWithFees({
        partnerId: result.odoo_partner_id,
        productName: odooActivation,
        slideGroupId: slideGroupId,
        amount: netAmount,
        installments: instRows.length > 0 ? instRows.map(i => ({
          amount: Number(i.amount),
          due_date: i.due_date ? new Date(i.due_date).toISOString().slice(0, 10) : null
        })) : null
      })

      if (orderResult.success) {
        await pool.query(`UPDATE enrollments SET odoo_order_id = $1 WHERE enrollment_id = $2`, [orderResult.order_id, enrollmentId])
      }
    } catch (orderErr) {
      console.error('[enrollInOdoo] Error creando orden de venta:', orderErr.message)
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
  const { rows } = await pool.query(`
    SELECT e.enrollment_id, e.total_amount, e.discount_amount,
           per.first_name, per.last_name,
           l.origin_email,
           pv.abbreviation AS program_name,
           prog.banner_link,
           pe.start_date, pe.whatsapp_link,
           curr.variable_2 AS currency_symbol,
           e.odoo_user_id,
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
  const isNew = !data.odoo_user_id
  const odooEmail = isNew
    ? `${lastName.toLowerCase()}.${firstName.toLowerCase()}@weeducacion.edu.pe`
    : (data.origin_email || '')

  const htmlBody = buildConfirmacionHTML({
    studentName: `${firstName} ${lastName}`,
    programName: data.program_name,
    startDate: data.start_date,
    frequency, schedule,
    whatsappLink: data.whatsapp_link || '',
    email: odooEmail,
    isNew,
    bannerUrl: data.banner_link || '',
    installments: data.payment_plan_alias === 'we_payment_way_single' ? [] : (instRows || []),
    currencySymbol: data.currency_symbol || 'S/.'
  })

  return {
    html: htmlBody,
    to: data.origin_email || '---',
    subject: `Confirmacion de Inscripcion - ${data.program_name || 'WE Educacion'}`
  }
}

async function sendConfirmationEmail ({ enrollmentId }) {
  const { rows: checkRows } = await pool.query(`
    SELECT pv.abbreviation FROM enrollments e
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    WHERE e.enrollment_id = $1
  `, [enrollmentId])
  if (checkRows?.[0] && isMembership(checkRows[0].abbreviation)) {
    return sendMembershipEmail({ enrollmentId })
  }

  const { rows } = await pool.query(`
    SELECT e.enrollment_id, e.total_amount, e.discount_amount,
           per.first_name, per.last_name, per.document_number,
           l.origin_email,
           pv.abbreviation AS program_name,
           prog.banner_link,
           pe.start_date,
           pe.whatsapp_link,
           curr.variable_2 AS currency_symbol,
           e.odoo_user_id,
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

  const toEmail = data.origin_email
  if (!toEmail) return { success: false, error: 'El estudiante no tiene correo registrado' }

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
  const isNew = !data.odoo_user_id
  const odooEmail = isNew
    ? `${lastName.toLowerCase()}.${firstName.toLowerCase()}@weeducacion.edu.pe`
    : toEmail

  const htmlBody = buildConfirmacionHTML({
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
    currencySymbol: data.currency_symbol || 'S/.'
  })

  const subject = `Confirmacion de Inscripcion - ${data.program_name || 'WE Educacion'}`
  const result = await sendEmail({ to: toEmail, subject, htmlBody })

  try {
    await pool.query(`
      INSERT INTO public.email_logs (enrollment_id, to_email, subject, message_id, template_type, status)
      VALUES ($1, $2, $3, $4, 'confirmacion', $5)
    `, [enrollmentId, toEmail, subject, result.messageId || null, result.success ? 'sent' : 'failed'])
  } catch (logErr) {
    console.error('[EmailLog] Error registrando log:', logErr.message)
  }

  if (result.success) {
    await logAudit({ enrollmentId, action: 'email_sent', userId: null, details: `Correo confirmacion enviado a ${toEmail}` })
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
           l.origin_email,
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

async function sendActivationEmail ({ enrollmentId }) {
  const { rows } = await pool.query(`
    SELECT e.enrollment_id,
           per.first_name,
           l.origin_email,
           pv.abbreviation AS program_name
    FROM enrollments e
    JOIN customers cust ON cust.customer_id = e.customer_id
    JOIN persons per ON per.person_id = cust.person_id
    LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    WHERE e.enrollment_id = $1
  `, [enrollmentId])

  const data = rows?.[0]
  if (!data) return { success: false, error: 'Inscripcion no encontrada' }

  const toEmail = data.origin_email
  if (!toEmail) return { success: false, error: 'El estudiante no tiene correo registrado' }

  const htmlBody = buildActivacionHTML({
    studentName: data.first_name
  })

  const subject = `Tus cursos ya estan activos - ${data.program_name || 'WE Educacion'}`
  const result = await sendFicoEmail({ to: toEmail, subject, htmlBody })

  try {
    await pool.query(`
      INSERT INTO public.email_logs (enrollment_id, to_email, subject, message_id, template_type, status)
      VALUES ($1, $2, $3, $4, 'activacion', $5)
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

async function confirmInstallment ({ installmentId, enrollmentId, catCurrency, catPaymentMedium, catBusinessEntity, bankAccountId, transactionCode, voucherUrl, userId }) {
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

  await pool.query(`
    INSERT INTO payments (enrollment_id, installment_id, amount, payment_date, transaction_code,
      cat_method_payment, cat_payment_type, cat_settlement_status,
      settled_in_account_id, evidence_url, active, user_registration_id, registration_date)
    VALUES ($1, $2, $3, NOW(), $4, $5, 3115, 2573, $6, $7, 'Y', $8, NOW())
  `, [enrollmentId, installmentId, inst.amount, transactionCode || '', catPaymentMedium || null, bankAccountId || null, voucherUrl || null, userId])

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

  return { result: 1, message: 'Cuota confirmada' }
}

async function resolveBankLabel (accountId) {
  if (!accountId) return null
  const { rows } = await pool.query('SELECT bank_name, currency, account_number FROM bank_accounts WHERE account_id = $1', [accountId])
  const r = rows?.[0]
  return r ? `${r.bank_name || ''} ${r.currency || ''} ${r.account_number || ''}`.trim() : String(accountId)
}

async function enrollmentUpdate ({ enrollmentId, fields, justificacion, userId }) {
  const changes = {}

  const { rows: oldEnroll } = await pool.query('SELECT cat_currency FROM enrollments WHERE enrollment_id = $1', [enrollmentId])
  const { rows: oldPay } = await pool.query('SELECT payment_id, cat_method_payment, settled_in_account_id, transaction_code FROM payments WHERE enrollment_id = $1 AND active = \'Y\' ORDER BY payment_date DESC LIMIT 1', [enrollmentId])
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

  const paymentFields = { cat_payment_medium: 'cat_method_payment', transaction_code: 'transaction_code', bank_account_id: 'settled_in_account_id' }
  const pSets = []
  const pParams = []
  let pIdx = 1
  for (const [formKey, dbKey] of Object.entries(paymentFields)) {
    if (fields[formKey] !== undefined) {
      pSets.push(`${dbKey} = $${pIdx}`)
      pParams.push(fields[formKey])
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
  }
  if (fields.transaction_code !== undefined && fields.transaction_code !== (oldP.transaction_code || '')) {
    changes['N. Operacion'] = { old: oldP.transaction_code || '---', new: fields.transaction_code || '---' }
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
             pv.abbreviation, prog.odoo_activation, pe.start_date
      FROM enrollments e
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN programs prog ON prog.program_id = pv.program_id
      LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      WHERE e.enrollment_id = $1
    `, [enrollmentId])

    const data = rows?.[0]
    if (isMembership(data?.abbreviation)) return { success: false, error: 'Membresias no sincronizan cuotas con Odoo' }
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

function isMembership (programName) {
  const name = (programName || '').toUpperCase()
  return name.includes('MEMB') || name.includes('PLUS') || name.includes('PLAT') || name.includes('BLACK') || name.includes('GOLD')
}

async function enrollMembershipInOdoo ({ enrollmentId }) {
  const { rows } = await pool.query(`
    SELECT e.enrollment_id, per.first_name, per.last_name, per.document_number,
           l.origin_email, pv.abbreviation AS program_name
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
  const searchEmail = data.origin_email
  const normalize = s => (s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '').replace(/\s+/g, '.')
  const createEmail = `${normalize(data.last_name)}.${normalize(data.first_name)}@weeducacion.edu.pe`
  const password = 'WE' + String(data.document_number || '').slice(-4) + '!'

  const result = await odooClient.enrollInAllOnlineCourses({ searchEmail, createEmail, fullName, password })

  if (result.success) {
    await pool.query(`
      UPDATE enrollments SET odoo_user_id = $1 WHERE enrollment_id = $2
    `, [result.odoo_user_id, enrollmentId])
  }

  return result
}

async function sendMembershipEmail ({ enrollmentId }) {
  const { rows } = await pool.query(`
    SELECT e.enrollment_id, per.first_name, per.last_name,
           l.origin_email, pv.abbreviation AS program_name,
           pe.start_date, e.odoo_user_id,
           curr.variable_2 AS currency_symbol
    FROM enrollments e
    JOIN customers cust ON cust.customer_id = e.customer_id
    JOIN persons per ON per.person_id = cust.person_id
    LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN catalog curr ON e.cat_currency = curr.catalog_id
    WHERE e.enrollment_id = $1
  `, [enrollmentId])

  const data = rows?.[0]
  if (!data) return { success: false, error: 'Inscripcion no encontrada' }

  const toEmail = data.origin_email
  if (!toEmail) return { success: false, error: 'Sin correo registrado' }

  const startDate = data.start_date ? new Date(data.start_date) : new Date()
  const fechaAct = startDate.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const { rows: instRows } = await pool.query(`
    SELECT installment_number, amount, due_date
    FROM payment_installments WHERE enrollment_id = $1 AND installment_number > 0
    ORDER BY installment_number
  `, [enrollmentId])

  let installmentsHTML = ''
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

  const htmlBody = buildMembresiaHTML({
    studentName: `${data.first_name} ${data.last_name}`,
    programName: data.program_name,
    email: toEmail,
    password: '1234567',
    isNew: !data.odoo_user_id,
    duracion: '12 meses',
    fechaActivacion: fechaAct,
    fechaRenovacion: '---',
    installmentsHTML,
    bloqueBeneficios: '',
    fichaRegistroLink: 'https://we-educacion-certificacion.com/'
  })

  const tipo = detectMembershipType(data.program_name)
  const subject = `Bienvenido a tu Membresia ${tipo} - WE Educacion`
  const result = await sendEmail({ to: toEmail, subject, htmlBody })

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
           l.origin_phone AS student_phone,
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

  const { rows: retCat } = await pool.query(
    `SELECT catalog_id FROM catalog WHERE alias = 'we_enrollment_status_retired' LIMIT 1`
  )
  if (!retCat?.[0]?.catalog_id) throw new Error('Catalogo de estado Retirado no encontrado')
  const retId = retCat[0].catalog_id

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
      `SELECT e.odoo_user_id, e.odoo_order_id, l.origin_email, prog.odoo_activation
       FROM enrollments e
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
           l.origin_email, l.origin_phone
    FROM enrollments e
    JOIN customers cust ON cust.customer_id = e.customer_id
    JOIN persons per ON per.person_id = cust.person_id
    LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
    LEFT JOIN catalog c_fico ON c_fico.catalog_id = e.cat_fico_status
    WHERE e.enrollment_id = $1
  `, [enrollmentId])
  const r = rows?.[0]
  if (r) {
    r.odoo_email = r.stored_odoo_email || (r.odoo_user_id ? buildOdooEmail(r.first_name, r.last_name) : null)
  }
  return r || null
}

async function editStudent ({ enrollmentId, firstName, lastName, documentNumber, originEmail, originPhone, odooEmail, newProfileId, justificacion, userId }) {
  const { rows: currentRows } = await pool.query(`
    SELECT per.first_name, per.last_name, per.document_number, per.person_id,
           l.origin_email, l.origin_phone, l.lead_id,
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

    if (changes['Correo Odoo'] && current.odoo_user_id) {
      try {
        await odooClient.updateUserLogin(current.odoo_user_id, odooEmail)
      } catch (e) {
        console.error('[editStudent] Error actualizando login en Odoo:', e.message)
      }
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
  const person = {
    cat_type_document: data.cat_type_document,
    document_number: data.document_number,
    first_name: data.first_name,
    last_name: data.last_name
  }

  const { rows: srcLeadRows } = await pool.query(`
    SELECT * FROM leads WHERE enrollment_id IS NOT NULL ORDER BY lead_id DESC LIMIT 1
  `)
  const src = srcLeadRows?.[0] || {}

  const lead = {
    origin_email: data.email,
    origin_phone: data.phone,
    cat_code_country: data.cat_country,
    cat_channel: data.cat_payment_channel || src.cat_channel,
    cat_medium_contact: src.cat_medium_contact,
    cat_prospect_situation: src.cat_prospect_situation,
    cat_frecuency_word: src.cat_frecuency_word,
    cat_type_strategy: src.cat_type_strategy,
    cat_interest_level: src.cat_interest_level,
    cat_query: src.cat_query,
    cat_client_type: src.cat_client_type,
    program_version_id: data.program_version_id,
    program_edition_id: data.program_edition_id,
    full_name: `${data.first_name} ${data.last_name}`.trim(),
    cat_status_lead: src.cat_status_lead,
    pay_date: new Date().toISOString().slice(0, 10)
  }

  const leadRows = await callProcedureReturningRows(
    pool,
    'public.sp_comercial_lead_register',
    [
      JSON.stringify(person),
      JSON.stringify(lead),
      JSON.stringify([]),
      userId
    ],
    { statementTimeoutMs: 25000 }
  )

  const leadResp = leadRows?.[0]
  if (!leadResp || leadResp.result !== 1) {
    return { result: 0, message: leadResp?.message || 'Error al crear el lead' }
  }

  const leadId = leadResp.lead_id
  if (!leadId) return { result: 0, message: 'No se obtuvo lead_id' }

  const inscription = {
    lead_id: leadId,
    program_version_id: data.program_version_id,
    program_edition_id: data.program_edition_id,
    cat_insc_modality: data.cat_insc_modality,
    cat_payment_channel: data.cat_payment_channel,
    cat_currency: data.cat_currency,
    cat_payment_way: data.cat_payment_way,
    list_price: data.list_price || 0,
    total_amount: data.total_amount || 0,
    saved_money: data.saved_money || 0,
    observations: data.observations,
    installment_plan: data.installment_plan || null,
    document: data.document_number,
    cat_type_document: data.cat_type_document,
    full_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    cat_country: data.cat_country
  }

  const enrollRows = await callProcedureReturningRows(
    pool,
    'public.sp_comercial_enrollment_register',
    [leadId, userId, JSON.stringify({ inscription })],
    { statementTimeoutMs: 25000 }
  )

  const enrollResp = enrollRows?.[0] || { result: 0, message: 'Sin respuesta del SP' }

  if (enrollResp.result === 1 && enrollResp.enrollment_id) {
    const eid = enrollResp.enrollment_id

    const { rows: catRows } = await pool.query(
      `SELECT catalog_id FROM catalog WHERE alias = 'we_enrollment_status_checked' LIMIT 1`
    )
    if (catRows?.[0]?.catalog_id) {
      await pool.query(`UPDATE enrollments SET cat_fico_status = $1 WHERE enrollment_id = $2`, [catRows[0].catalog_id, eid])
    }

    await logAudit({ enrollmentId: eid, action: 'created', userId, details: 'Inscripcion registrada desde FICO' })
    await logAudit({ enrollmentId: eid, action: 'approved', userId, details: 'Auto-aprobado por registro directo FICO' })

    try {
      const odoo = await enrollInOdoo({ enrollmentId: eid })
      if (odoo?.success) {
        await logAudit({ enrollmentId: eid, action: 'odoo_enrolled', userId, details: `Odoo user: ${odoo.odoo_user_id}` })
      }
    } catch (e) { console.error('[FICO] Odoo auto-enroll failed:', e.message) }

    try {
      const emailRes = await sendConfirmationEmail({ enrollmentId: eid })
      if (emailRes?.success) {
        await logAudit({ enrollmentId: eid, action: 'email_sent', userId, details: `Correo confirmacion: ${emailRes.messageId}` })
      }
    } catch (e) { console.error('[FICO] Email auto-send failed:', e.message) }
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
           l.origin_email,
           prog.odoo_activation
    FROM enrollments e
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
    const { rows: rpCat } = await pool.query(
      `SELECT catalog_id FROM catalog WHERE alias = 'we_enrollment_status_reprogrammed' LIMIT 1`
    )
    console.log('[reprogramEdition] catalog RP:', JSON.stringify(rpCat))
    console.log('[reprogramEdition] enrollmentId:', enrollmentId)
    if (rpCat?.[0]?.catalog_id) {
      const upd = await pool.query(
        'UPDATE enrollments SET cat_type_status = $1 WHERE enrollment_id = $2',
        [rpCat[0].catalog_id, enrollmentId]
      )
      console.log('[reprogramEdition] UPDATE result rowCount:', upd.rowCount)
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

async function courseChange ({ enrollmentId, newProgramVersionId, newEditionId, totalAmount, justificacion, userId, cat_currency, cat_method_payment, cat_business_entity, bank_account_id, transaction_code, ticket_payment_urls }) {
  const { rows: oldRows } = await pool.query(`
    SELECT e.enrollment_id, e.program_version_id, e.program_edition_id,
           e.customer_id, e.seller_agent_id, e.cat_currency,
           e.total_amount, e.discount_amount,
           e.cat_inscription_modality, e.cat_payment_channel, e.cat_payment_plan,
           per.first_name, per.last_name, per.document_number, per.cat_type_document,
           l.lead_id, l.origin_email, l.cat_code_country,
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

  const { rows: ccCat } = await pool.query(
    `SELECT catalog_id FROM catalog WHERE alias = 'we_enrollment_status_course_changed' LIMIT 1`
  )
  if (ccCat?.[0]?.catalog_id) {
    await pool.query(
      'UPDATE enrollments SET cat_type_status = $1 WHERE enrollment_id = $2',
      [ccCat[0].catalog_id, enrollmentId]
    )
  }

  const ccNote = `Cambio de curso desde inscripcion #${enrollmentId} (${old.old_program_name || ''} ${old.old_edition_code || ''})`

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

  const { rows: newLeadRows } = await pool.query(`
    INSERT INTO leads (${allCols.map(c => `"${c}"`).join(', ')})
    SELECT ${selectParts.join(', ')}
    FROM leads l
    WHERE l.enrollment_id = $1
    RETURNING lead_id
  `, [enrollmentId])

  const newLeadId = newLeadRows?.[0]?.lead_id
  if (!newLeadId) throw new Error('Error al crear el lead para el cambio de curso')

  const { rows: certCat } = await pool.query(
    `SELECT catalog_id FROM catalog WHERE alias = 'we_certificate_status_paid' LIMIT 1`
  )
  const { rows: contadoCat } = await pool.query(
    `SELECT catalog_id FROM catalog WHERE alias = 'we_payment_way_single' LIMIT 1`
  )
  const { rows: oldPayment } = await pool.query(
    `SELECT cat_method_payment FROM payments WHERE enrollment_id = $1 AND active = 'Y' ORDER BY payment_id DESC LIMIT 1`,
    [enrollmentId]
  )
  let methodPayment = oldPayment?.[0]?.cat_method_payment || null
  if (!methodPayment) {
    const { rows: defMethod } = await pool.query(
      `SELECT catalog_id FROM catalog WHERE alias = 'we_payment_method_transfer' LIMIT 1`
    )
    methodPayment = defMethod?.[0]?.catalog_id || null
  }

  const inscription = {
    lead_id: newLeadId,
    program_version_id: newProgramVersionId,
    program_edition_id: newEditionId,
    cat_insc_modality: old.cat_inscription_modality,
    cat_payment_channel: old.cat_payment_channel,
    cat_currency: old.cat_currency,
    cat_payment_way: contadoCat?.[0]?.catalog_id || old.cat_payment_plan,
    cat_type_payment: contadoCat?.[0]?.catalog_id || old.cat_payment_plan,
    cat_method_payment: cat_method_payment || methodPayment,
    cat_certificate_status: certCat?.[0]?.catalog_id || null,
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

  const { rows: catChecked } = await pool.query(
    `SELECT catalog_id FROM catalog WHERE alias = 'we_enrollment_status_checked' LIMIT 1`
  )
  if (catChecked?.[0]?.catalog_id && newEid) {
    await pool.query('UPDATE enrollments SET cat_fico_status = $1 WHERE enrollment_id = $2', [catChecked[0].catalog_id, newEid])
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
  await pool.query(`
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
    try {
      if (old.old_odoo_activation) {
        const { rows: odooData } = await pool.query(
          `SELECT odoo_user_id, odoo_order_id FROM enrollments WHERE enrollment_id = $1`, [enrollmentId]
        ).catch(() => ({ rows: [] }))
        const od = odooData?.[0]

        if (od?.odoo_user_id) {
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
          await logAudit({ enrollmentId, action: 'odoo_unenrolled', userId, details: `Desinscrito de Odoo: ${old.old_odoo_activation}` })
        }
      }
    } catch (e) { console.error('[courseChange] Error desinscribiendo de Odoo:', e.message) }

    try {
      const odoo = await enrollInOdoo({ enrollmentId: newEid })
      if (odoo?.success) {
        await logAudit({ enrollmentId: newEid, action: 'odoo_enrolled', userId, details: `Inscrito en Odoo: user ${odoo.odoo_user_id}` })
      }
    } catch (e) { console.error('[courseChange] Error inscribiendo en Odoo:', e.message) }

    try {
      const emailRes = await sendConfirmationEmail({ enrollmentId: newEid })
      if (emailRes?.success) {
        await logAudit({ enrollmentId: newEid, action: 'email_sent', userId, details: `Correo confirmacion CC: ${emailRes.messageId}` })
      }
    } catch (e) { console.error('[courseChange] Error enviando email:', e.message) }
  }

  return { result: 1, message: 'Cambio de curso realizado', new_enrollment_id: newEid }
}

async function getEnrollmentSnapshot (enrollmentId) {
  const { rows } = await pool.query(`
    SELECT e.total_amount, e.discount_amount, e.list_price,
           l.origin_email, l.origin_phone,
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
           l.lead_id
    FROM enrollments e
    JOIN customers cust ON cust.customer_id = e.customer_id
    JOIN persons per ON per.person_id = cust.person_id
    LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    WHERE e.enrollment_id = $1
  `, [enrollmentId])

  if (!rows?.[0]) throw new Error('Inscripcion no encontrada')
  const data = rows[0]

  const { rows: obsCat } = await pool.query(
    `SELECT catalog_id FROM catalog WHERE alias = 'we_enrollment_status_observed' LIMIT 1`
  )
  if (!obsCat?.[0]?.catalog_id) throw new Error('Catalogo de estado Observado no encontrado')

  await pool.query(
    'UPDATE enrollments SET cat_fico_status = $1 WHERE enrollment_id = $2',
    [obsCat[0].catalog_id, enrollmentId]
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

  return { result: 1, message: 'Inscripcion observada correctamente' }
}

async function resubmitEnrollment ({ enrollmentId, userId }) {
  const { rows: obsCat } = await pool.query(
    `SELECT catalog_id FROM catalog WHERE alias = 'we_enrollment_status_observed' LIMIT 1`
  )
  if (!obsCat?.[0]?.catalog_id) throw new Error('Catalogo de estado Observado no encontrado')

  const { rows: chk } = await pool.query(
    'SELECT cat_fico_status, seller_agent_id FROM enrollments WHERE enrollment_id = $1',
    [enrollmentId]
  )
  if (!chk?.[0]) throw new Error('Inscripcion no encontrada')
  if (chk[0].cat_fico_status !== obsCat[0].catalog_id) throw new Error('La inscripcion no esta en estado Observado')

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

async function getProgramChildren ({ programVersionId }) {
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
  return rows
}

export default {
  enrollmentList,
  paymentDetailGet,
  confirmPayment,
  bankAccountList,
  enrollInOdoo,
  sendConfirmationEmail,
  sendPaymentConfirmationEmail,
  sendActivationEmail,
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
  getProgramChildren
}
