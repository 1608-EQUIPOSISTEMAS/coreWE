import 'dotenv/config'

// ─── Validación de entorno al arranque ───────────────────────────────────────
const REQUIRED_ENV = ['ODOO_URL', 'ODOO_DB', 'ODOO_LOGIN', 'ODOO_PASSWORD']
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`[odooClient] Variable de entorno requerida: ${key}`)
}

const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_PASSWORD } = process.env

const SESSION_TTL_MS = 28 * 60 * 1000

const session = {
  cookie:    null,
  expiresAt: 0,
  isValid () { return !!this.cookie && Date.now() < this.expiresAt },
  set (cookie) {
    this.cookie    = cookie
    this.expiresAt = Date.now() + SESSION_TTL_MS
  },
  clear () {
    this.cookie    = null
    this.expiresAt = 0
  }
}

// ─── Error Detectado ─────────────────────────────────────────────────────────────
export class OdooError extends Error {
  constructor (message, code = null) {
    super(message)
    this.name = 'OdooError'
    this.code = code
  }
}

// ─── Transporte ───────────────────────────────────────────────────────────────
async function post (endpoint, params, cookie = null) {
  let res
  try {
    res = await fetch(`${ODOO_URL}${endpoint}`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: Date.now(), params })
    })
  } catch (err) {
    throw new OdooError(`No se pudo conectar con Odoo: ${err.message}`, 'NETWORK_ERROR')
  }

  if (!res.ok) throw new OdooError(`HTTP ${res.status}`, 'HTTP_ERROR')

  const json = await res.json()

  if (json.error) {
    const msg  = json.error?.data?.message || JSON.stringify(json.error)
    const code = json.error?.data?.name    || 'RPC_ERROR'
    throw new OdooError(msg, code)
  }

  return { result: json.result, setCookie: res.headers.get('set-cookie') }
}

// ─── Autenticación ────────────────────────────────────────────────────────────
async function authenticate () {
  const { result, setCookie } = await post('/web/session/authenticate', {
    db:       ODOO_DB,
    login:    ODOO_LOGIN,
    password: ODOO_PASSWORD
  })

  if (!result?.uid) throw new OdooError('Credenciales Odoo inválidas', 'AUTH_FAILED')

  const match = (setCookie || '').match(/session_id=[^;]+/)
  if (!match) throw new OdooError('Odoo no devolvió session_id', 'AUTH_FAILED')

  session.set(match[0])
}

// ─── Núcleo ────────────────────────────────────────────────────────────────────
async function callKw (model, method, args = [], kwargs = {}) {
  if (!session.isValid()) await authenticate()

  try {
    const { result } = await post(
      '/web/dataset/call_kw',
      { model, method, args, kwargs: { context: {}, ...kwargs } },
      session.cookie
    )
    return result
  } catch (err) {
    if (err.code === 'odoo.exceptions.SessionExpiredException') {
      session.clear()
      await authenticate()
      const { result } = await post(
        '/web/dataset/call_kw',
        { model, method, args, kwargs: { context: {}, ...kwargs } },
        session.cookie
      )
      return result
    }
    throw err
  }
}

// ─── Operaciones de dominio ───────────────────────────────────────────────────
async function createUser ({ login, name }) {
  return await callKw('res.users', 'create', [{
    login,
    name,
    email:              login,
    employee:           true,
    sel_groups_1_8_9:   1,    // 1=Interno | 8=Portal | 9=Público
    sel_groups_130_131: 130   // 130=Profesor | 131=Administrador
  }])
}

async function getUserById (userId) {
  const rows = await callKw('res.users', 'read', [
    [userId],
    ['id', 'name', 'partner_id']
  ])
  return rows?.[0] ?? null
}

async function updatePartner (partnerId, { email, linkedin, internalNotes, parentId } = {}) {
  const vals = {
    is_published: true,
    ...(email         && { email }),
    ...(linkedin      && { social_linkedin: linkedin }),
    ...(internalNotes && { comment: internalNotes }),
    ...(parentId      && { parent_id: parentId })
  }
  return await callKw('res.partner', 'write', [[partnerId], vals])
}

// ─── Flujo de sincronización ──────────────────────────────────────────────────
/**
 * Sincroniza un instructor recién creado con Odoo.
 * Crea usuario → obtiene partner_id → actualiza partner.
 * Retorna siempre un objeto; nunca lanza al caller.
 *
 * @returns {{ odoo_user_id: number|null, odoo_partner_id: number|null, odoo_error: string|null }}
 */
async function syncInstructorToOdoo ({ login, name, password, linkedin, internalNotes, parentId } = {}) {
  if (!login || !name) {
    console.warn('[odooClient] syncInstructorToOdoo omitido: faltan login o name')
    return { odoo_user_id: null, odoo_partner_id: null, odoo_error: 'login y name son requeridos' }
  }

  try {
    const odooUserId    = await createUser({ login, name })

    await callKw('res.users', 'write', [[odooUserId], { password }])

    const user          = await getUserById(odooUserId)
    const odooPartnerId = user?.partner_id?.[0] ?? null

    if (odooPartnerId) {
        await updatePartner(odooPartnerId, { email: login, linkedin, internalNotes, parentId })
    }

    return { odoo_user_id: odooUserId, odoo_partner_id: odooPartnerId, odoo_error: null }

    } catch (err) {
    console.error('[odooClient] syncInstructorToOdoo:', err.message)
    return { odoo_user_id: null, odoo_partner_id: null, odoo_error: err.message }
    }
}

// ─── Operaciones de Estudiante ───────────────────────────────────────────────

async function searchUserByEmail (email) {
  const rows = await callKw('res.users', 'search_read', [
    [['login', '=', email]]
  ], { fields: ['id', 'name', 'login', 'partner_id'], limit: 1 })
  return rows?.[0] ?? null
}

async function createPortalUser ({ login, name, password }) {
  const userId = await callKw('res.users', 'create', [{
    login,
    name,
    email:            login,
    employee:         false,
    sel_groups_1_8_9: 8   // 8=Portal
  }])
  if (password) {
    await callKw('res.users', 'write', [[userId], { password }])
  }
  return userId
}

async function searchSlideGroup (courseName) {
  const rows = await callKw('slide.group', 'search_read', [
    [['name', 'ilike', courseName]]
  ], { fields: ['id', 'name', 'slide_channel_id'], limit: 50 })
  return rows || []
}

async function getSlideGroup (groupId) {
  const rows = await callKw('slide.group', 'read', [
    [groupId]
  ], { fields: ['id', 'name', 'slide_channel_id'] })
  return rows?.[0] ?? null
}

async function enrollStudentInCourse ({ partnerId, slideGroupId, slideChannelId, evaluationTypeId = 2 }) {
  const existing = await callKw('slide.group.student', 'search', [
    [['partner_id', '=', partnerId], ['slide_group_id', '=', slideGroupId]]
  ], { limit: 1 })
  if (existing && existing.length > 0) {
    return { student_id: existing[0], already_enrolled: true }
  }
  const studentId = await callKw('slide.group.student', 'create', [{
    partner_id:        partnerId,
    slide_group_id:    slideGroupId,
    slide_channel_id:  slideChannelId,
    evaluation_type_id: evaluationTypeId
  }])
  return { student_id: studentId, already_enrolled: false }
}

async function syncStudentToOdoo ({ searchEmail, createEmail, fullName, password, slideGroupId }) {
  try {
    let user = await searchUserByEmail(searchEmail)
    let odooUserId, odooPartnerId, created = false

    if (user) {
      odooUserId    = user.id
      odooPartnerId = user.partner_id?.[0] ?? null
    } else {
      odooUserId = await createPortalUser({ login: createEmail, name: fullName, password })
      const userData = await getUserById(odooUserId)
      odooPartnerId = userData?.partner_id?.[0] ?? null
      created = true
    }

    if (!odooPartnerId) {
      return { success: false, error: 'No se pudo obtener partner_id', odoo_user_id: odooUserId }
    }

    const group = await getSlideGroup(slideGroupId)
    if (!group) {
      return { success: false, error: `slide.group ID ${slideGroupId} no encontrado`, odoo_user_id: odooUserId }
    }

    const slideChannelId = group.slide_channel_id?.[0]
    const enrollment = await enrollStudentInCourse({
      partnerId:      odooPartnerId,
      slideGroupId:   slideGroupId,
      slideChannelId: slideChannelId
    })

    return {
      success: true,
      odoo_user_id:     odooUserId,
      odoo_partner_id:  odooPartnerId,
      odoo_student_id:  enrollment.student_id,
      user_created:     created,
      already_enrolled: enrollment.already_enrolled,
      password_set:     created ? password : null,
      error: null
    }
  } catch (err) {
    console.error('[odooClient] syncStudentToOdoo:', err.message)
    return { success: false, error: err.message, odoo_user_id: null }
  }
}

async function enrollInAllOnlineCourses ({ searchEmail, createEmail, fullName, password }) {
  try {
    let user = await searchUserByEmail(searchEmail)
    let odooUserId, odooPartnerId, created = false

    if (user) {
      odooUserId = user.id
      odooPartnerId = user.partner_id?.[0] ?? null
    } else {
      odooUserId = await createPortalUser({ login: createEmail, name: fullName, password })
      const userData = await getUserById(odooUserId)
      odooPartnerId = userData?.partner_id?.[0] ?? null
      created = true
    }

    if (!odooPartnerId) {
      return { success: false, error: 'No se pudo obtener partner_id', odoo_user_id: odooUserId }
    }

    const channels = await callKw('slide.channel', 'search_read', [
      [['website_published', '=', true]]
    ], { fields: ['id', 'name'], limit: 200 })

    let enrolled = 0
    for (const ch of (channels || [])) {
      try {
        const existing = await callKw('slide.channel.partner', 'search', [
          [['partner_id', '=', odooPartnerId], ['channel_id', '=', ch.id]]
        ], { limit: 1 })
        if (!existing || existing.length === 0) {
          await callKw('slide.channel.partner', 'create', [{
            partner_id: odooPartnerId,
            channel_id: ch.id
          }])
          enrolled++
        }
      } catch (e) {
        console.error(`[odooClient] Error enrolling in channel ${ch.name}:`, e.message)
      }
    }

    return {
      success: true,
      odoo_user_id: odooUserId,
      odoo_partner_id: odooPartnerId,
      user_created: created,
      password_set: created ? password : null,
      channels_enrolled: enrolled,
      total_channels: channels?.length || 0
    }
  } catch (err) {
    console.error('[odooClient] enrollInAllOnlineCourses:', err.message)
    return { success: false, error: err.message, odoo_user_id: null }
  }
}

async function createSaleOrderWithFees ({ partnerId, productName, slideGroupId, amount, installments }) {
  const products = await callKw('product.product', 'search_read', [
    [['name', 'ilike', productName]]
  ], { fields: ['id', 'name'], limit: 5 })

  const product = products?.[0]
  if (!product) {
    console.warn(`[odooClient] Producto no encontrado: "${productName}"`)
    return { success: false, error: `Producto no encontrado: ${productName}` }
  }

  const orderId = await callKw('sale.order', 'create', [{
    partner_id: partnerId,
    order_line: [[0, 0, {
      product_id: product.id,
      product_uom_qty: 1,
      price_unit: amount,
      slide_group_id: slideGroupId || false
    }]]
  }])

  await callKw('sale.order', 'action_confirm', [[orderId]])

  const fees = await callKw('sale.order.fee', 'search_read', [
    [['order_id', '=', orderId]]
  ], { fields: ['id', 'seq', 'state'], limit: 20 })

  if (installments && installments.length > 0 && fees.length > 0) {
    for (let i = 0; i < Math.min(installments.length, fees.length); i++) {
      await callKw('sale.order.fee', 'write', [[fees[i].id], {
        amount: installments[i].amount,
        due_date: installments[i].due_date
      }])
    }
  }

  return {
    success: true,
    order_id: orderId,
    fee_count: fees.length,
    fee_ids: fees.map(f => f.id)
  }
}

async function markFeeAsPaid (feeId) {
  await callKw('sale.order.fee', 'write', [[feeId], { state: 'pagado', payment_state: 'saldado' }])
  return { success: true }
}

async function findOdooFees ({ partnerId, slideGroupId }) {
  const fees = await callKw('sale.order.fee', 'search_read', [
    [['partner_id', '=', partnerId], ['slide_group_id', '=', slideGroupId], ['state', '=', 'pendiente']]
  ], { fields: ['id', 'name', 'amount', 'due_date', 'seq', 'state'], limit: 20, order: 'seq asc' })
  return fees || []
}

async function unenrollStudentFromCourse ({ partnerId, slideGroupId }) {
  try {
    const studentIds = await callKw('slide.group.student', 'search', [
      [['partner_id', '=', partnerId], ['slide_group_id', '=', slideGroupId]]
    ], { limit: 10 })
    if (studentIds && studentIds.length > 0) {
      await callKw('slide.group.student', 'unlink', [studentIds])
    }

    const group = await getSlideGroup(slideGroupId)
    if (group?.slide_channel_id?.[0]) {
      const channelPartnerIds = await callKw('slide.channel.partner', 'search', [
        [['partner_id', '=', partnerId], ['channel_id', '=', group.slide_channel_id[0]]]
      ], { limit: 10 })
      if (channelPartnerIds && channelPartnerIds.length > 0) {
        await callKw('slide.channel.partner', 'unlink', [channelPartnerIds])
      }
    }

    return { success: true, removed_students: studentIds?.length || 0 }
  } catch (err) {
    console.error('[odooClient] unenrollStudentFromCourse:', err.message)
    return { success: false, error: err.message }
  }
}

async function cancelSaleOrder (orderId) {
  try {
    if (!orderId) return { success: false, error: 'Sin order_id' }
    await callKw('sale.order', 'action_cancel', [[orderId]])
    return { success: true }
  } catch (err) {
    console.error('[odooClient] cancelSaleOrder:', err.message)
    return { success: false, error: err.message }
  }
}

export default { callKw, syncInstructorToOdoo, syncStudentToOdoo, searchUserByEmail, searchSlideGroup, enrollInAllOnlineCourses, createSaleOrderWithFees, markFeeAsPaid, findOdooFees, unenrollStudentFromCourse, cancelSaleOrder }