// Cliente mínimo de la WhatsApp Cloud API (Graph API de Meta). Sin SDK: fetch
// nativo, igual que gemini.adapter.js.
//
// La versión de Graph NO tiene valor por defecto a propósito: Meta da de baja
// versiones y una vieja escrita aquí fallaría en silencio meses después. Se fija
// en el .env con la que muestra la app en developers.facebook.com.
const BASE = 'https://graph.facebook.com'

function settings () {
  const { WHATSAPP_TOKEN, WHATSAPP_GRAPH_VERSION } = process.env
  if (!WHATSAPP_TOKEN || !WHATSAPP_GRAPH_VERSION) {
    throw new Error('WhatsApp no configurado: faltan WHATSAPP_TOKEN o WHATSAPP_GRAPH_VERSION en el .env')
  }
  return { token: WHATSAPP_TOKEN, version: WHATSAPP_GRAPH_VERSION }
}

async function graph (path, init) {
  const { token, version } = settings()
  const res = await fetch(`${BASE}/${version}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers }
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Meta ${res.status}: ${json.error?.message ?? 'sin detalle'}`)
  return json
}

// Sube el archivo a Meta y devuelve su media id. Así no hace falta que /uploads
// sea público: Meta nunca descarga nada del ERP.
export async function uploadMedia ({ phoneNumberId, buffer, mimeType, filename }) {
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', mimeType)
  form.append('file', new Blob([buffer], { type: mimeType }), filename)
  const { id } = await graph(`${phoneNumberId}/media`, { method: 'POST', body: form })
  return id
}

// Devuelve el wamid del mensaje enviado.
export async function sendMessage ({ phoneNumberId, payload }) {
  const json = await graph(`${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return json.messages?.[0]?.id ?? null
}
