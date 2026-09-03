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
  if (!email) return null
  const normalized = String(email).trim().toLowerCase()
  if (!normalized) return null

  // Validacion de "ya registrado en Odoo": el filtro es UNICAMENTE esta peticion
  // -> search_read sobre res.users por login. Usamos =ilike (insensible a
  // mayusculas) en vez de = exacto para que un login guardado con otra
  // capitalizacion siga haciendo match y NO se cree un correo duplicado. El
  // login es la unica llave segura: el email de partner se repite entre personas
  // (un padre con varios hijos, asesor que reusa correo, lead test reutilizado)
  // y devolvia un user que NO correspondia al alumno actual. Si Odoo responde
  // con una fila => la persona ya existe y NO se le crea otro correo; si
  // responde [] => no esta registrada.
  const rows = await callKw('res.users', 'search_read', [], {
    domain:  [['login', '=ilike', normalized]],
    fields:  ['name', 'login', 'partner_id', 'surnames', 'names'],
    context: { website_id: 1 },
    limit:   1
  })
  return rows?.[0] || null
}

// Busca al alumno en Odoo por su documento (`res.partner.vat`). El login puede
// ser sintetico y el correo del lead puede venir mal escrito, pero el DNI es el
// mismo siempre: sin este paso, un alumno que YA existe en Odoo con otro login
// recibe un usuario nuevo con sufijo numerico (carbajal.fernando2@...).
//
// `vat` NO es unico en Odoo: hay partners con el DNI de otra persona pegado por
// error. Ante mas de un partner con el mismo documento se devuelve vacio en vez
// de adivinar: matricular al alumno A en la cuenta de B es peor que crearle un
// login duplicado.
// Devuelve TODOS los usuarios del alumno (un partner puede arrastrar varios
// logins de altas repetidas). Cual de ellos gana lo decide `resolveOdooLogin`:
// aqui solo se transporta, la politica vive en el helper.
async function searchUsersByDocument (documentNumber) {
  const vat = String(documentNumber || '').trim()
  if (!vat) return []

  const partners = await callKw('res.partner', 'search_read', [], {
    domain: [['vat', '=', vat]],
    fields: ['id', 'email', 'user_ids'],
    limit:  2
  })
  if (partners?.length !== 1) return []

  const userIds = partners[0].user_ids || []
  if (!userIds.length) return []

  const users = await callKw('res.users', 'read', [userIds, ['name', 'login', 'partner_id', 'surnames', 'names']])
  return users || []
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

// Campos de nombre partido del partner (`names` / `surnames`). Van SIEMPRE que
// se toque el partner: Certificacion los usa para emitir el certificado y el
// `name` completo no le sirve. Solo escribe lo que viene con valor (nunca borra).
function buildPartnerNameVals ({ names, surnames } = {}) {
  const vals = {}
  if (names && String(names).trim() !== '') vals.names = String(names).trim()
  if (surnames && String(surnames).trim() !== '') vals.surnames = String(surnames).trim()
  return vals
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

async function syncStudentToOdoo ({ searchEmail, createEmail, fullName, password, slideGroupId, phone, documentNumber, names, surnames }) {
  try {
    let user = await searchUserByEmail(searchEmail)
    if (!user && createEmail !== searchEmail) {
      user = await searchUserByEmail(createEmail)
    }
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

    // Sincroniza phone/vat (DNI) en res.partner. Se ejecuta tanto en creacion
    // como en reuso del partner existente: si el alumno ya tenia cuenta sin
    // estos datos, los completamos; nunca los borra (solo escribe si vienen).
    const partnerVals = buildPartnerNameVals({ names, surnames })
    if (phone && String(phone).trim() !== '') partnerVals.phone = String(phone).trim()
    if (documentNumber && String(documentNumber).trim() !== '') partnerVals.vat = String(documentNumber).trim()
    if (Object.keys(partnerVals).length > 0) {
      try {
        await callKw('res.partner', 'write', [[odooPartnerId], partnerVals])
      } catch (partnerErr) {
        console.error('[odooClient] syncStudentToOdoo: no se pudo escribir names/surnames/phone/vat en partner', odooPartnerId, partnerErr.message)
      }
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
      odoo_login:       user ? user.login : createEmail,
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

async function searchSlideChannelByName (channelName) {
  const rows = await callKw('slide.channel', 'search_read', [
    [['name', '=', channelName]]
  ], { fields: ['id', 'name'], limit: 5 })
  return rows || []
}

async function enrollStudentInChannelOnly ({ partnerId, slideChannelId }) {
  const existing = await callKw('slide.channel.partner', 'search', [
    [['partner_id', '=', partnerId], ['channel_id', '=', slideChannelId]]
  ], { limit: 1 })
  if (existing && existing.length > 0) {
    return { channel_partner_id: existing[0], already_enrolled: true }
  }
  const channelPartnerId = await callKw('slide.channel.partner', 'create', [{
    partner_id: partnerId,
    channel_id: slideChannelId
  }])
  return { channel_partner_id: channelPartnerId, already_enrolled: false }
}

async function syncStudentToOdooOnline ({ searchEmail, createEmail, fullName, password, slideChannelId, phone, documentNumber, names, surnames }) {
  try {
    let user = await searchUserByEmail(searchEmail)
    if (!user && createEmail !== searchEmail) {
      user = await searchUserByEmail(createEmail)
    }
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

    const partnerVals = buildPartnerNameVals({ names, surnames })
    if (phone && String(phone).trim() !== '') partnerVals.phone = String(phone).trim()
    if (documentNumber && String(documentNumber).trim() !== '') partnerVals.vat = String(documentNumber).trim()
    if (Object.keys(partnerVals).length > 0) {
      try {
        await callKw('res.partner', 'write', [[odooPartnerId], partnerVals])
      } catch (partnerErr) {
        console.error('[odooClient] syncStudentToOdooOnline: no se pudo escribir names/surnames/phone/vat en partner', odooPartnerId, partnerErr.message)
      }
    }

    const enrollment = await enrollStudentInChannelOnly({
      partnerId: odooPartnerId,
      slideChannelId
    })

    return {
      success: true,
      odoo_user_id:     odooUserId,
      odoo_partner_id:  odooPartnerId,
      odoo_student_id:  enrollment.channel_partner_id,
      odoo_login:       user ? user.login : createEmail,
      user_created:     created,
      already_enrolled: enrollment.already_enrolled,
      password_set:     created ? password : null,
      error: null
    }
  } catch (err) {
    console.error('[odooClient] syncStudentToOdooOnline:', err.message)
    return { success: false, error: err.message, odoo_user_id: null }
  }
}

// Canales publicados del Campus. Lo consumen Configuracion (para pintar la
// lista de cursos de membresia) y enrollInAllOnlineCourses cuando el caller no
// le pasa un set ya resuelto.
// Sin `limit`: Odoo devuelve todo. El limit 200 anterior truncaba en silencio.
async function listOnlineChannels () {
  const rows = await callKw('slide.channel', 'search_read', [
    [['website_published', '=', true]]
  ], { fields: ['id', 'name'], order: 'name asc' })
  return rows || []
}

// `channels` (opcional): [{ id, name }] ya curado por Configuracion. Si no
// viene, se cae a todos los publicados — comportamiento historico.
async function enrollInAllOnlineCourses ({ searchEmail, createEmail, fullName, password, phone, documentNumber, names, surnames, channels: presetChannels = null }) {
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

    const partnerVals = buildPartnerNameVals({ names, surnames })
    if (phone && String(phone).trim() !== '') partnerVals.phone = String(phone).trim()
    if (documentNumber && String(documentNumber).trim() !== '') partnerVals.vat = String(documentNumber).trim()
    if (Object.keys(partnerVals).length > 0) {
      try {
        await callKw('res.partner', 'write', [[odooPartnerId], partnerVals])
      } catch (partnerErr) {
        console.error('[odooClient] enrollInAllOnlineCourses: no se pudo escribir names/surnames/phone/vat en partner', odooPartnerId, partnerErr.message)
      }
    }

    const channels = presetChannels ?? await listOnlineChannels()

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
      odoo_login: user ? user.login : createEmail,
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

async function createSaleOrderWithFees ({ partnerId, productName, slideGroupId, amount, installments, currency, partnerEmail }) {
  const odooCtx = { context: { allowed_company_ids: [1], default_warehouse_id: 1 } }

  if (slideGroupId) {
    const existingFees = await callKw('sale.order.fee', 'search_read', [
      [['partner_id', '=', partnerId], ['slide_group_id', '=', slideGroupId]]
    ], { fields: ['order_id'], limit: 1 })
    if (existingFees?.[0]?.order_id) {
      const existingOrderId = Array.isArray(existingFees[0].order_id)
        ? existingFees[0].order_id[0]
        : existingFees[0].order_id
      console.log(`[odooClient] Reusing existing sale.order ${existingOrderId} for partner=${partnerId} slide_group=${slideGroupId}`)
      return { success: true, order_id: existingOrderId, reused: true }
    }
  }

  const products = await callKw('product.product', 'search_read', [
    [['name', 'ilike', productName]]
  ], { fields: ['id', 'name'], limit: 5 })
  const product = products?.[0]
  if (!product) {
    console.warn(`[odooClient] Producto no encontrado: "${productName}"`)
    return { success: false, error: `Producto no encontrado: ${productName}` }
  }

  const pricelistSearch = currency === 'USD' ? 'USD' : 'PEN'
  const pricelists = await callKw('product.pricelist', 'search_read', [
    [['name', 'ilike', pricelistSearch]]
  ], { fields: ['id', 'name'], limit: 3 })
  const pricelistId = pricelists?.[0]?.id || false

  const isInstallments = installments && installments.length > 0
  const termName = isInstallments ? 'Crédito' : 'Contado'
  const paymentTerms = await callKw('account.payment.term', 'search_read', [
    [['name', '=', termName]]
  ], { fields: ['id', 'name'], limit: 1 })
  if (!paymentTerms?.[0]) {
    return { success: false, error: `Payment term "${termName}" no encontrado en Odoo` }
  }
  const paymentTermId = paymentTerms[0].id

  const orderData = {
    partner_id: partnerId,
    company_id: 1,
    payment_term_id: paymentTermId,
    order_line: [[0, 0, {
      product_id: product.id,
      product_uom_qty: 1,
      price_unit: amount,
      slide_group_id: slideGroupId || false
    }]]
  }
  if (pricelistId) orderData.pricelist_id = pricelistId

  console.log('[odooClient] Creating sale order:', JSON.stringify({ partnerId, productName, pricelistId, paymentTermId, termName, amount, slideGroupId }))

  const orderId = await callKw('sale.order', 'create', [orderData], odooCtx)

  try {
    await callKw('sale.order', 'action_confirm', [[orderId]], odooCtx)
  } catch (confirmErr) {
    console.warn('[odooClient] action_confirm warning:', confirmErr.message)
    await callKw('sale.order', 'write', [[orderId], { state: 'sale' }], odooCtx)
  }
  try {
    await callKw('sale.order', 'action_done', [[orderId]], odooCtx)
  } catch (e) {}

  await callKw('sale.order', 'write', [[orderId], { payment_term_id: paymentTermId }], odooCtx)

  const fees = await callKw('sale.order.fee', 'search_read', [
    [['order_id', '=', orderId]]
  ], { fields: ['id', 'seq', 'state'], limit: 20, order: 'seq asc' })

  if (fees.length > 0 && partnerEmail) {
    const feeIds = fees.map(f => f.id)
    try {
      await callKw('sale.order.fee', 'write', [feeIds, { partner_email: partnerEmail }], odooCtx)
    } catch (e) {
      console.warn('[odooClient] No se pudo setear partner_email en fees:', e.message)
    }
  }

  return {
    success: true,
    order_id: orderId,
    fee_count: fees.length,
    fee_ids: fees.map(f => f.id)
  }
}

async function activateFees (orderId) {
  const fees = await callKw('sale.order.fee', 'search_read', [
    [['order_id', '=', orderId], ['state', '=', 'borrador']]
  ], { fields: ['id'], limit: 50 })
  if (fees.length > 0) {
    const ids = fees.map(f => f.id)
    await callKw('sale.order.fee', 'write', [ids, { state: 'pendiente' }], { context: { allowed_company_ids: [1] } })
  }
  return { success: true, activated: fees.length }
}

async function markFeeAsPaid (feeId) {
  await callKw('sale.order.fee', 'write', [[feeId], { state: 'pagado', payment_state: 'saldado' }])
  return { success: true }
}

async function updateFeeDueDates ({ orderId, changes }) {
  if (!orderId) return { success: false, error: 'Sin order_id' }
  if (!Array.isArray(changes) || changes.length === 0) return { success: true, updated: 0 }

  const multiCtx = { context: { allowed_company_ids: [1] } }

  const orderInfo = await callKw('sale.order', 'search_read', [
    [['id', '=', orderId]]
  ], { fields: ['id', 'name', 'state', 'payment_term_id', 'company_id', 'partner_id'], limit: 1, ...multiCtx })
  console.log(`[updateFeeDueDates] order=${orderId} info:`, orderInfo?.[0] || 'NO EXISTE')

  const fees = await callKw('sale.order.fee', 'search_read', [
    [['order_id', '=', orderId]]
  ], { fields: ['id', 'seq', 'state', 'due_date', 'amount', 'company_id'], limit: 50, order: 'seq asc', ...multiCtx })

  console.log(`[updateFeeDueDates] order=${orderId} fees encontradas: ${(fees || []).length}`,
    (fees || []).map(f => ({ id: f.id, seq: f.seq, state: f.state, due_date: f.due_date })))

  if (!fees || fees.length === 0) {
    return {
      success: false,
      error: orderInfo?.[0]
        ? 'Inscripcion antigua sin cuotas en Odoo. Sincronizar manualmente.'
        : 'Orden no existe en Odoo. Sincronizar manualmente.'
    }
  }

  const bySeq = new Map()
  for (const f of (fees || [])) bySeq.set(f.seq, f)

  const results = []
  for (const change of changes) {
    const fee = bySeq.get(change.seq)
    if (!fee) { results.push({ seq: change.seq, success: false, error: 'Fee no encontrada en Odoo' }); continue }
    if (fee.state === 'pagado') { results.push({ seq: change.seq, success: false, error: 'Fee ya pagada' }); continue }
    try {
      await callKw('sale.order.fee', 'write', [[fee.id], { due_date: change.new_due_date }], { context: { allowed_company_ids: [1] } })
      results.push({ seq: change.seq, fee_id: fee.id, success: true })
    } catch (err) {
      console.error(`[updateFeeDueDates] fee_id=${fee.id} seq=${change.seq}:`, err.message)
      results.push({ seq: change.seq, fee_id: fee.id, success: false, error: err.message })
    }
  }

  const failed = results.filter(r => !r.success)
  return { success: failed.length === 0, updated: results.length - failed.length, failed, results }
}

// Escritura generica sobre fees por seq (mismo write JSON-RPC crudo que se
// prueba en Postman): changes = [{ seq, values }]. Usado por la campaña de
// cobranza para anular fees ({ state: 'anulado' }) o ajustar montos.
async function updateFees ({ orderId, changes }) {
  if (!orderId) return { success: false, error: 'Sin order_id' }
  if (!Array.isArray(changes) || changes.length === 0) return { success: true, updated: 0 }

  const multiCtx = { context: { allowed_company_ids: [1] } }
  const fees = await callKw('sale.order.fee', 'search_read', [
    [['order_id', '=', orderId]]
  ], { fields: ['id', 'seq', 'state'], limit: 50, order: 'seq asc', ...multiCtx })

  if (!fees || fees.length === 0) {
    return { success: false, error: 'Orden sin cuotas en Odoo. Sincronizar manualmente.' }
  }

  const bySeq = new Map()
  for (const f of fees) bySeq.set(f.seq, f)

  const results = []
  for (const change of changes) {
    const fee = bySeq.get(change.seq)
    if (!fee) { results.push({ seq: change.seq, success: false, error: 'Fee no encontrada en Odoo' }); continue }
    if (fee.state === 'pagado') { results.push({ seq: change.seq, success: false, error: 'Fee ya pagada' }); continue }
    try {
      await callKw('sale.order.fee', 'write', [[fee.id], change.values], multiCtx)
      results.push({ seq: change.seq, fee_id: fee.id, success: true })
    } catch (err) {
      console.error(`[updateFees] fee_id=${fee.id} seq=${change.seq}:`, err.message)
      results.push({ seq: change.seq, fee_id: fee.id, success: false, error: err.message })
    }
  }

  const failed = results.filter(r => !r.success)
  return { success: failed.length === 0, updated: results.length - failed.length, failed, results }
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

// ─── Certificación masiva de aula ────────────────────────────────────────────
// Reproduce el flujo manual de la intranet Odoo: escribir notas en
// slide.group.evaluation → process.certification (masivo) → action_load_students
// → action_load_filter_approved → action_process_certificates → generar el PDF
// de cada issued.certificates (action_process_certificates NO genera el PDF).
// grades: [{ enrollment_id, odoo_student_id|null, student_name, has_debt,
//            midterm, final, participation, final_score }]
// Los con deuda reciben notas pero se excluyen del proceso hasta pagar.

// Tokens de nombre normalizados (sin tildes/puntuación) para el match de
// respaldo: alumnos matriculados en Odoo sin pasar por el ERP no tienen
// odoo_student_id guardado, pero sí figuran en Evaluaciones por nombre.
function nameTokens (s) {
  return new Set(
    String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ')
      .replace(/V/g, 'B') // CORDOVA (ERP) vs CORDOBA (Odoo): typo B/V frecuente
      .split(/\s+/).filter(Boolean)
  )
}

// Match si un nombre es subconjunto del otro (≥2 tokens): tolera apellido
// materno presente en un sistema y ausente en el otro.
function nameTokensMatch (a, b) {
  if (a.size < 2 || b.size < 2) return false
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  for (const t of small) if (!big.has(t)) return false
  return true
}

async function certifyClassroom ({ groupName, grades }) {
  const groups = await callKw('slide.group', 'search_read', [
    [['name', '=', groupName]]
  ], { fields: ['id', 'name', 'slide_channel_id'], limit: 1 })
  const group = groups?.[0]
  if (!group) return { success: false, error: `Grupo de curso no encontrado en Odoo: "${groupName}"` }
  const slideGroupId = group.id
  const slideChannelId = group.slide_channel_id?.[0]

  // 1) Notas → slide.group.evaluation. Match por slide.group.student id y, si
  // no hay id guardado, por nombre (único). Filas duplicadas: se escriben todas.
  const evals = await callKw('slide.group.evaluation', 'search_read', [
    [['slide_group_id', '=', slideGroupId]]
  ], { fields: ['id', 'student_id', 'partner_id'], limit: 1000 })
  const evalsByStudent = new Map()
  for (const ev of (evals || [])) {
    const sid = ev.student_id?.[0]
    if (!sid) continue
    if (!evalsByStudent.has(sid)) evalsByStudent.set(sid, [])
    evalsByStudent.get(sid).push(ev)
  }

  const gradesApplied = []
  const gradesMissing = []
  const resolvedByName = []
  const duplicateSids = new Set() // student_id duplicados de la misma persona: nota sí, certificado no
  for (const g of grades) {
    // allSids: todos los slide.group.student de la persona (Odoo a veces la
    // tiene duplicada). El primero certifica; los demás solo reciben nota.
    let allSids = (g.odoo_student_id && evalsByStudent.has(g.odoo_student_id)) ? [g.odoo_student_id] : null
    if (!allSids) {
      const gTokens = nameTokens(g.student_name)
      const candidates = []
      for (const [csid, list] of evalsByStudent) {
        const odooName = list[0].partner_id?.[1] || list[0].student_id?.[1] || ''
        if (nameTokensMatch(gTokens, nameTokens(odooName))) candidates.push({ sid: csid, name: odooName })
      }
      if (candidates.length === 1) {
        allSids = [candidates[0].sid]
      } else if (candidates.length > 1) {
        // Solo si TODOS los candidatos son el mismo nombre = misma persona
        // duplicada; nombres distintos = ambiguo, mejor no adivinar.
        const keys = new Set(candidates.map(c => [...nameTokens(c.name)].sort().join(' ')))
        if (keys.size === 1) allSids = candidates.map(c => c.sid)
      }
      if (allSids && g.enrollment_id) {
        resolvedByName.push({ enrollment_id: g.enrollment_id, odoo_student_id: allSids[0] })
      }
    }
    if (!allSids) { gradesMissing.push(g.student_name); continue }
    for (const dup of allSids.slice(1)) duplicateSids.add(dup)
    const evalIds = allSids.flatMap(sid => evalsByStudent.get(sid).map(e => e.id))
    await callKw('slide.group.evaluation', 'write', [evalIds, {
      midterm_exam:  g.midterm,
      final_exam:    g.final,
      participation: g.participation,
      final_score:   g.final_score
    }])
    gradesApplied.push({ ...g, student_id: allSids[0], all_sids: allSids, eval_ids: evalIds })
  }

  // La nota OFICIAL del certificado es la de Odoo (decision del area academica,
  // 2026-09-03): final_score es computado alla y pisa lo que mandamos. Releerlo no
  // es una alarma, es dejar constancia de con que nota quedo certificado el alumno.
  const scoreMismatches = []
  if (gradesApplied.length) {
    const ids = gradesApplied.flatMap(g => g.eval_ids)
    const back = await callKw('slide.group.evaluation', 'read', [ids, ['student_id', 'final_score']])
    const expected = new Map(gradesApplied.map(g => [g.student_id, g]))
    for (const row of (back || [])) {
      const g = expected.get(row.student_id?.[0])
      if (g && Math.abs((row.final_score ?? 0) - g.final_score) > 0.01) {
        scoreMismatches.push(`${g.student_name}: ERP ${g.final_score} → oficial ${row.final_score}`)
      }
    }
  }

  // 2) Certificados ya emitidos del grupo (en cualquier proceso): nunca se
  // duplican. Un proceso publicado NO se reabre; los alumnos nuevos van en un
  // proceso nuevo del mismo grupo.
  const certsBefore = await callKw('issued.certificates', 'search_read', [
    [['slide_group_id', '=', slideGroupId], ['state', '!=', 'cancel']]
  ], { fields: ['id', 'student_id'], limit: 1000 })
  const alreadyCertified = new Set((certsBefore || []).map(c => c.student_id?.[0]).filter(Boolean))

  // Exclusión a nivel persona: deuda o certificado previo bajo CUALQUIERA de
  // sus student_id (duplicados incluidos) la deja fuera del proceso.
  const debtorIdSet = new Set(gradesApplied.filter(g => g.has_debt).flatMap(g => g.all_sids))
  const dropSet = new Set(duplicateSids)
  for (const g of gradesApplied) {
    if (g.has_debt || g.all_sids.some(s => alreadyCertified.has(s))) {
      for (const s of g.all_sids) dropSet.add(s)
    }
  }
  const toCertify = gradesApplied.filter(g => !g.has_debt && !g.all_sids.some(s => alreadyCertified.has(s)))

  // Proceso reutilizable = el más reciente del grupo aún no publicado.
  let proc = (await callKw('process.certification', 'search_read', [
    [['slide_group_id', '=', slideGroupId], ['state', '!=', 'published']]
  ], { fields: ['id', 'name', 'state'], limit: 1, order: 'id desc' }))?.[0]

  let procCreated = false
  let newCertificates = 0
  if (!proc && toCertify.length) {
    const procId = await callKw('process.certification', 'create', [{
      type: 'massive',
      slide_channel_id: slideChannelId,
      slide_group_id: slideGroupId
    }])
    proc = { id: procId, state: 'draft' }
    procCreated = true
  }

  let procFinal = null
  if (proc) {
    if (proc.state === 'draft') {
      await callKw('process.certification', 'action_load_students', [[proc.id]])
      proc.state = 'load_students'
    }
    if (proc.state === 'load_students') {
      await callKw('process.certification', 'action_load_filter_approved', [[proc.id]])
      proc.state = 'approved'
    }
    if (proc.state === 'approved') {
      // Fuera deudores, ya certificados y líneas duplicadas de una misma
      // persona; quedan solo aprobados nuevos al día, una línea por persona.
      const dropIds = [...new Set([...dropSet, ...alreadyCertified])]
      if (dropIds.length) {
        const lineIds = await callKw('process.certification.line', 'search', [
          [['process_certification_id', '=', proc.id], ['student_id', 'in', dropIds]]
        ], { limit: 500 })
        if (lineIds?.length) await callKw('process.certification.line', 'unlink', [lineIds])
      }
      // issued.certificates exige student_names/student_surnames: los alumnos
      // matriculados a mano en Odoo los tienen vacíos → se completan desde el
      // ERP. Sin datos ni en el ERP, la línea sale del proceso (se reporta).
      const remaining = await callKw('process.certification.line', 'search_read', [
        [['process_certification_id', '=', proc.id]]
      ], { fields: ['id', 'student_id', 'student_names', 'student_surnames'], limit: 500 })
      const bySid = new Map(gradesApplied.flatMap(g => g.all_sids.map(s => [s, g])))
      let processable = 0
      for (const line of (remaining || [])) {
        if (line.student_names && line.student_surnames) { processable++; continue }
        const g = bySid.get(line.student_id?.[0])
        const names = line.student_names || g?.first_name
        const surnames = line.student_surnames || g?.last_name
        if (names && surnames) {
          await callKw('process.certification.line', 'write', [[line.id], {
            student_names: names, student_surnames: surnames
          }])
          processable++
        } else {
          gradesMissing.push(`${line.student_id?.[1] || `línea ${line.id}`} (sin nombres/apellidos)`)
          await callKw('process.certification.line', 'unlink', [[line.id]])
        }
      }
      if (processable > 0) {
        await callKw('process.certification', 'action_process_certificates', [[proc.id]])
        newCertificates = processable
      }
    }
    procFinal = (await callKw('process.certification', 'read', [[proc.id], ['name', 'state']]))?.[0]
  }

  // 3) Generar PDF de los certificados del grupo que aún no lo tengan
  // (de cualquier proceso), salvo deudores.
  const certs = await callKw('issued.certificates', 'search_read', [
    [['slide_group_id', '=', slideGroupId], ['state', '!=', 'cancel']]
  ], { fields: ['id', 'code', 'state', 'certificate_file', 'student_id'], limit: 1000 })

  let pdfsGenerated = 0
  const pdfErrors = []
  for (const c of (certs || [])) {
    if (c.certificate_file) continue
    if (debtorIdSet.has(c.student_id?.[0])) continue
    try {
      await callKw('issued.certificates', 'action_generate_certificate', [[c.id]])
      pdfsGenerated++
    } catch (err) {
      pdfErrors.push(`${c.code}: ${err.message}`)
    }
  }

  // Código de certificado por enrollment (para marcar la fila de notas en el
  // ERP): cubre también certificados de corridas/procesos anteriores del grupo.
  const certified = []
  for (const g of gradesApplied) {
    const cert = (certs || []).find(c => c.state !== 'cancel' && g.all_sids.includes(c.student_id?.[0]))
    if (cert && g.enrollment_id) certified.push({ enrollment_id: g.enrollment_id, cert_code: cert.code })
  }

  return {
    success: true,
    certified,
    slide_group_id: slideGroupId,
    process_id: proc?.id || null,
    process_name: procFinal?.name || null,
    process_state: procFinal?.state || null,
    process_created: procCreated,
    grades_applied: gradesApplied.length,
    grades_missing: gradesMissing,
    matched_by_name: resolvedByName.length,
    resolved_by_name: resolvedByName,
    already_certified: alreadyCertified.size,
    new_certificates: newCertificates,
    score_mismatches: scoreMismatches,
    certificates_total: certs?.length || 0,
    pdfs_generated: pdfsGenerated,
    pdf_errors: pdfErrors
  }
}

async function updateUserLogin (odooUserId, newLogin) {
  try {
    await callKw('res.users', 'write', [[odooUserId], { login: newLogin, email: newLogin }])
    return { success: true }
  } catch (err) {
    console.error('[odooClient] updateUserLogin:', err.message)
    return { success: false, error: err.message }
  }
}

/**
 * Sincroniza edicion de alumno con Odoo: actualiza res.users y res.partner.
 * Solo escribe los campos que vienen definidos (undefined = no tocar).
 * Nunca lanza al caller — captura errores y devuelve { success, error }.
 */
async function updateStudentInOdoo (odooUserId, { name, login, phone, vat, names, surnames } = {}) {
  if (!odooUserId) return { success: false, error: 'odooUserId requerido' }

  try {
    const userVals = {}
    if (name !== undefined && name !== null && String(name).trim() !== '') userVals.name = String(name).trim()
    if (login !== undefined && login !== null && String(login).trim() !== '') {
      userVals.login = String(login).trim()
      userVals.email = String(login).trim()
    }
    if (Object.keys(userVals).length) {
      await callKw('res.users', 'write', [[odooUserId], userVals])
    }

    const [user] = await callKw('res.users', 'read', [[odooUserId], ['partner_id']])
    const partnerId = user?.partner_id?.[0] ?? null

    if (partnerId) {
      const partnerVals = buildPartnerNameVals({ names, surnames })
      if (userVals.name)     partnerVals.name   = userVals.name
      if (userVals.email)    partnerVals.email  = userVals.email
      if (phone !== undefined && phone !== null && String(phone).trim() !== '') partnerVals.phone = String(phone).trim()
      if (vat   !== undefined && vat   !== null && String(vat).trim()   !== '') partnerVals.vat   = String(vat).trim()
      if (Object.keys(partnerVals).length) {
        await callKw('res.partner', 'write', [[partnerId], partnerVals])
      }
    }

    return { success: true }
  } catch (err) {
    console.error('[odooClient] updateStudentInOdoo:', err.message)
    return { success: false, error: err.message }
  }
}

export default { callKw, certifyClassroom, syncInstructorToOdoo, syncStudentToOdoo, syncStudentToOdooOnline, searchUserByEmail, searchUsersByDocument, searchSlideGroup, searchSlideChannelByName, enrollStudentInChannelOnly, listOnlineChannels, enrollInAllOnlineCourses, createSaleOrderWithFees, activateFees, markFeeAsPaid, updateFeeDueDates, updateFees, findOdooFees, unenrollStudentFromCourse, cancelSaleOrder, updateUserLogin, updateStudentInOdoo }