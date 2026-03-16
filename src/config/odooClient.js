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

export default { callKw, syncInstructorToOdoo }