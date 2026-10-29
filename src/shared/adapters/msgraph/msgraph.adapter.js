// Cliente minimo de Microsoft Graph para eventos de calendario con reunion de
// Teams (Aulas > links por sesion). Credenciales de aplicacion (client
// credentials) de la app registrada en Entra ID con el permiso de aplicacion
// Calendars.ReadWrite. Sin SDK: son 4 llamadas REST y el fetch de Node 20.
//
// Variables de entorno:
//   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET  -> la app de Entra ID
//
// El organizador (buzon donde vive el evento) lo decide quien llama: cada
// llamada recibe el UPN del buzon.

const GRAPH = 'https://graph.microsoft.com/v1.0'
// Reintentos ante 429 (throttling) y 5xx: respeta Retry-After si viene.
const RETRY_DELAYS_MS = [2000, 5000, 15000]

let _token = null // { value, expiresAt }

export function isGraphConfigured (env = process.env) {
  return Boolean(env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET)
}

async function getToken () {
  if (_token && _token.expiresAt - 60_000 > Date.now()) return _token.value
  if (!isGraphConfigured()) {
    throw new Error('Microsoft Graph no configurado: faltan MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET')
  }
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  })
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', body }
  )
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.access_token) {
    throw new Error(`Token de Microsoft rechazado: ${json.error_description || json.error || res.status}`)
  }
  _token = { value: json.access_token, expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000 }
  return _token.value
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function graphRequest (method, path, payload) {
  for (let attempt = 0; ; attempt++) {
    const token = await getToken()
    const res = await fetch(`${GRAPH}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // Fechas de respuesta en hora de Lima, igual que las que mandamos.
        // include-unknown-enum-members: sin esto Graph devuelve el rol
        // 'coorganizer' como 'unknownFutureValue'.
        Prefer: 'outlook.timezone="SA Pacific Standard Time", include-unknown-enum-members'
      },
      body: payload ? JSON.stringify(payload) : undefined
    })
    if (res.status === 204) return null
    const json = await res.json().catch(() => null)
    if (res.ok) return json

    const retryable = res.status === 429 || res.status >= 500
    if (retryable && attempt < RETRY_DELAYS_MS.length) {
      const retryAfter = Number(res.headers.get('retry-after')) * 1000
      await sleep(retryAfter > 0 ? retryAfter : RETRY_DELAYS_MS[attempt])
      continue
    }
    if (res.status === 401) _token = null
    const err = new Error(`Graph ${method} ${path} -> ${res.status}: ${json?.error?.message || 'sin detalle'}`)
    err.statusCode = res.status
    err.graphCode = json?.error?.code || null
    throw err
  }
}

const userPath = (upn) => `/users/${encodeURIComponent(upn)}`

// Crea el evento con reunion de Teams. transactionId hace idempotente el POST:
// si un reintento llega despues de que Graph ya lo creo, devuelve el mismo.
export function createTeamsEvent (organizer, event) {
  return graphRequest('POST', `${userPath(organizer)}/events`, event)
}

// Cambia fecha/hora/asunto. El joinUrl de Teams se conserva.
export function updateTeamsEvent (organizer, eventId, patch) {
  return graphRequest('PATCH', `${userPath(organizer)}/events/${encodeURIComponent(eventId)}`, patch)
}

// Cancela (avisa a los invitados). Si el evento ya no existe, no es error.
export async function cancelTeamsEvent (organizer, eventId, comment = '') {
  try {
    await graphRequest('POST', `${userPath(organizer)}/events/${encodeURIComponent(eventId)}/cancel`, { comment })
  } catch (err) {
    if (err.statusCode === 404) return
    throw err
  }
}

// Borra el evento sin avisar a nadie (limpieza de pruebas). Ya borrado = ok.
export async function deleteTeamsEvent (organizer, eventId) {
  try {
    await graphRequest('DELETE', `${userPath(organizer)}/events/${encodeURIComponent(eventId)}`)
  } catch (err) {
    if (err.statusCode === 404) return
    throw err
  }
}

// ── Opciones de la reunion de Teams (API onlineMeetings) ─────────────────────
// Requiere el permiso de aplicacion OnlineMeetings.ReadWrite.All y una
// politica de acceso de aplicacion de Teams asignada al organizador
// (scripts/teams-access-policy.ps1). Esta API pide el id (objectId) del
// organizador, no su correo: sale del propio link (organizerIdFromJoinUrl).

// La reunion de Teams que nacio con el evento de calendario, por su link.
export async function findOnlineMeetingByJoinUrl (organizerId, joinUrl) {
  const filter = encodeURIComponent(`JoinWebUrl eq '${String(joinUrl).replace(/'/g, "''")}'`)
  const res = await graphRequest('GET', `/users/${organizerId}/onlineMeetings?$filter=${filter}`)
  return res?.value?.[0] || null
}

export function updateOnlineMeeting (organizerId, meetingId, patch) {
  return graphRequest('PATCH', `/users/${organizerId}/onlineMeetings/${encodeURIComponent(meetingId)}`, patch)
}

// Verificacion de configuracion: token + acceso al calendario del organizador.
// Lee un evento como maximo; no crea nada.
export async function checkOrganizerAccess (organizer) {
  await getToken()
  await graphRequest('GET', `${userPath(organizer)}/events?$top=1&$select=id`)
  return true
}

// Solo para tests.
export function _resetGraphToken () { _token = null }
