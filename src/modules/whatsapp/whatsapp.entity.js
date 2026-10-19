// Reglas puras del bot comercial de WhatsApp. Sin BD, red ni reloj oculto:
// `now` siempre entra como argumento.

const HOUR_MS = 60 * 60 * 1000

// Meta: si el negocio responde a un lead de anuncio, todo es gratis por 72 h.
export const FREE_ENTRY_WINDOW_HOURS = 72
// Una hora de colchón: la plantilla de derivación debe salir DENTRO de la FEP.
export const HANDOFF_AT_HOURS = 71
// Fuera de las 24 h desde el último mensaje del lead, solo plantillas aprobadas.
export const SERVICE_WINDOW_HOURS = 24

export const HANDOFF_TEMPLATE = 'derivacion_asesora'
export const FOLLOW_UP_TEMPLATE = 'seguimiento_24h'

const hoursBetween = (from, to) => (new Date(to) - new Date(from)) / HOUR_MS

// Qué puede mandar el bot ahora mismo a esta conversación.
// 'free_text' | 'template' | 'handoff' | 'stop'
// La regla B (una respuesta tras derivar) NO va aquí: ver canSendPostHandoffReply.
// El orden importa: derivar ya cerró el trabajo del bot, y la hora 71 gana a
// la ventana de 24 h porque la plantilla de derivación sale aunque el lead calle.
export function nextMessageMode ({ windowOpenedAt, lastLeadMessageAt, handoffSentAt, now }) {
  if (handoffSentAt) return 'stop'
  if (windowOpenedAt && now >= handoffDueAt(windowOpenedAt)) return 'handoff'
  if (hoursBetween(lastLeadMessageAt, now) >= SERVICE_WINDOW_HOURS) return 'template'
  return 'free_text'
}

// Lo primero que el bot manda cuando reconoce el programa del lead.
// ponytail: guion fijo de 3 archivos; un guion por programa cuando Comercial lo pida.
export const PROGRAM_INFO_SLOTS = [
  { slot: 'docente', caption: 'Staff docente' },
  { slot: 'brochure', caption: 'Revisa el BROCHURE 👇🏻' },
  { slot: 'certificado', caption: 'Modelo de Certificado' }
]

// Primera respuesta automática: solo si el bot aún no habló, sabe de qué
// programa le preguntan y la ventana de servicio está abierta.
export function shouldSendProgramInfo ({ conversation, now }) {
  return conversation.status === 'BOT' &&
    !conversation.window_opened_at &&
    Boolean(conversation.program_id) &&
    nextMessageMode({
      windowOpenedAt: null,
      lastLeadMessageAt: conversation.last_lead_message_at,
      handoffSentAt: conversation.handoff_sent_at,
      now
    }) === 'free_text'
}

export function handoffDueAt (windowOpenedAt) {
  return new Date(new Date(windowOpenedAt).getTime() + HANDOFF_AT_HOURS * HOUR_MS)
}

// Lo que se escribe a mano desde el ERP es texto libre: Meta lo rechaza pasadas
// 24 h del último mensaje del lead (ahí solo valen plantillas aprobadas).
export function canReplyFreeText ({ lastLeadMessageAt, now }) {
  return Boolean(lastLeadMessageAt) && hoursBetween(lastLeadMessageAt, now) < SERVICE_WINDOW_HOURS
}

// Una conversación que entra por la línea de una asesora es suya desde el primer
// mensaje: el bot solo atiende en su propio número.
export const initialStatusFor = numberRole => numberRole === 'ADVISOR' ? 'ADVISOR' : 'BOT'

// El bot es un asesor más y lo opera Líder Comercial: ve y responde todo. Quien
// reciba el permiso por la matriz ve solo su línea y lo que el bot le derivó.
export const LEADER_ROLES = ['ADMIN', 'LIDER_COMERCIAL']
export const isWhatsappLeader = (roles = []) => roles.some(role => LEADER_ROLES.includes(role))

export function canSeeConversation ({ conversation, userId, roles }) {
  if (isWhatsappLeader(roles)) return true
  return conversation.number_user_id === userId || conversation.advisor_user_id === userId
}

// Responder sale del número de la conversación: la asesora solo desde su línea.
export function canReplyConversation ({ conversation, userId, roles }) {
  return isWhatsappLeader(roles) || conversation.number_user_id === userId
}

export const DEFAULT_PROGRAM_LABEL = 'nuestros programas'

// Regla B: el texto que manda el bot si el lead le vuelve a escribir tras derivar.
export function buildAdvisorLinkText ({ contactName, advisorLabel, advisorPhone }) {
  const saludo = contactName ? `Hola ${contactName}` : 'Hola'
  return `${saludo}, ahora te atiende ${advisorLabel} por su WhatsApp. Escríbele aquí 👉 https://wa.me/${advisorPhone}`
}

export function buildTextMessage ({ to, body }) {
  return { messaging_product: 'whatsapp', to, type: 'text', text: { body } }
}

// Regla B: tras la derivación, si el lead le vuelve a escribir al bot, este
// responde una sola vez con el enlace de la asesora y luego calla.
export function canSendPostHandoffReply ({ handoffSentAt, postHandoffReplyAt }) {
  return Boolean(handoffSentAt) && !postHandoffReplyAt
}

// Minúsculas, sin tildes, sin el *negrita* de WhatsApp y espacios colapsados:
// el texto prellenado llega como el lead lo dejó (a veces lo edita un poco).
export function normalizeText (text = '') {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[*_~]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// PC2 = anuncio de Meta (el webhook trae `referral`); PC1/PC3 se reconocen por
// la frase prellenada del manual ("estoy en facebook" / "estoy en la web").
export function detectSource ({ text, referral }) {
  if (referral) return 'PC2'
  const normalized = normalizeText(text)
  if (normalized.includes('estoy en la web')) return 'PC3'
  if (normalized.includes('estoy en facebook')) return 'PC1'
  return 'DIRECT'
}

// Programa cuya frase prellenada aparece en el mensaje. Gana la frase más larga:
// "power bi" no debe ganarle a "especializacion en power bi".
// ponytail: escaneo lineal de ~65 programas × 2 frases; índice si el catálogo crece mucho.
export function matchProgramByPrefill (text, programs) {
  const normalized = normalizeText(text)
  let best = null
  for (const { program_id, prefill_phrases } of programs) {
    for (const phrase of prefill_phrases) {
      const candidate = normalizeText(phrase)
      if (candidate && normalized.includes(candidate) && candidate.length > (best?.length ?? 0)) {
        best = { program_id, length: candidate.length }
      }
    }
  }
  return best?.program_id ?? null
}

// Payload de la Cloud API para la plantilla de derivación. El cuerpo aprobado
// en Meta lleva {{1}} nombre del lead, {{2}} asesora, {{3}} programa; el botón
// URL es `https://wa.me/{{1}}` y aquí se completa con el número de la asesora.
export function buildHandoffTemplate ({ to, contactName, advisorLabel, programName, advisorPhone }) {
  const text = value => ({ type: 'text', text: value })
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: HANDOFF_TEMPLATE,
      language: { code: 'es' },
      components: [
        { type: 'body', parameters: [text(contactName || 'Hola'), text(advisorLabel), text(programName)] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [text(advisorPhone)] }
      ]
    }
  }
}

// La regla de formatos es la misma que valida la subida en Producto.
export { mediaKindFor, MAX_IMAGE_BYTES } from '../../shared/program-media.js'

export function buildMediaMessage ({ to, kind, mediaId, caption, filename }) {
  const media = { id: mediaId }
  if (caption) media.caption = caption
  if (kind === 'document') media.filename = filename
  return { messaging_product: 'whatsapp', to, type: kind, [kind]: media }
}

// Aplana el webhook de Meta (entry[].changes[].value) a lo que el ERP usa:
// mensajes entrantes y cambios de estado de los salientes. Lo que no es
// `messages` ni `statuses` (plantillas, calidad del número) se ignora.
export function parseWebhook (body) {
  const messages = []
  const statuses = []
  for (const entry of body?.entry ?? []) {
    for (const { value } of entry.changes ?? []) {
      const names = Object.fromEntries((value?.contacts ?? []).map(c => [c.wa_id, c.profile?.name ?? null]))
      for (const m of value?.messages ?? []) {
        messages.push(toIncomingMessage(m, value.metadata?.phone_number_id, names[m.from] ?? null))
      }
      for (const s of value?.statuses ?? []) {
        // `errors` solo viene cuando status = 'failed': es el único lugar donde
        // Meta dice POR QUÉ no entregó (el envío ya había respondido "accepted").
        statuses.push({ wamid: s.id, status: s.status, errors: s.errors ?? null })
      }
    }
  }
  return { messages, statuses }
}

function toIncomingMessage (m, phoneNumberId, contactName) {
  const media = m[m.type]?.id ? m[m.type] : null
  return {
    phoneNumberId,
    from: m.from,
    contactName,
    wamid: m.id,
    sentAt: new Date(Number(m.timestamp) * 1000),
    type: m.type,
    text: messageText(m),
    media: media && { id: media.id, mimeType: media.mime_type ?? null, filename: media.filename ?? null },
    referral: m.referral ?? null,
    raw: m
  }
}

function messageText (m) {
  switch (m.type) {
    case 'text': return m.text?.body ?? null
    case 'button': return m.button?.text ?? null
    case 'interactive': return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null
    default: return m[m.type]?.caption ?? null
  }
}
