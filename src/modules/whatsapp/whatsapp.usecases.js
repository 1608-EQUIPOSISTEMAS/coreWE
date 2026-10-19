import { whatsappRepository } from './whatsapp.repository.js'
import {
  parseWebhook, detectSource, matchProgramByPrefill, mediaKindFor, buildMediaMessage,
  shouldSendProgramInfo, PROGRAM_INFO_SLOTS, initialStatusFor, canSendPostHandoffReply,
  buildAdvisorLinkText, buildTextMessage, buildHandoffTemplate, HANDOFF_TEMPLATE, HANDOFF_AT_HOURS,
  canReplyFreeText, canSeeConversation, canReplyConversation, isWhatsappLeader, DEFAULT_PROGRAM_LABEL
} from './whatsapp.entity.js'
import { readProgramMedia, missingProgramMedia } from '../../shared/adapters/storage/whatsapp-media.adapter.js'
import * as cloudApi from '../../config/whatsappClient.js'
import { DomainError, ForbiddenError, NotFoundError } from '../../shared/errors.js'

const repo = whatsappRepository

// Meta registra la URL del webhook con un GET y espera recibir el challenge tal cual.
export function verifyWebhookSubscription ({ mode, token, challenge }) {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN
  return mode === 'subscribe' && Boolean(expected) && token === expected ? challenge : null
}

export async function ingestWebhook (body, log) {
  const { messages, statuses } = parseWebhook(body)
  for (const message of messages) await storeIncomingMessage(message, log)
  for (const status of statuses) {
    if (status.status === 'failed') log.error({ wamid: status.wamid, errors: status.errors }, 'WhatsApp: Meta no entregó el mensaje')
    await repo.updateDeliveryStatus(status)
  }
}

async function storeIncomingMessage (message, log) {
  const number = await repo.findActiveNumber(message.phoneNumberId)
  if (!number) {
    log.warn({ phoneNumberId: message.phoneNumberId }, 'WhatsApp: mensaje a un número que no está en wa_numbers')
    return
  }
  const conversation = await repo.upsertConversation({
    waNumberId: number.wa_number_id,
    contactPhone: message.from,
    contactName: message.contactName,
    programId: matchProgramByPrefill(message.text ?? '', await repo.listProgramPrefills()),
    source: detectSource(message),
    referral: message.referral,
    leadMessageAt: message.sentAt,
    status: initialStatusFor(number.role)
  })
  // ponytail: la imagen/PDF queda como media.id en payload; se baja al bucket cuando exista el cliente de la Cloud API.
  const stored = await repo.insertIncomingMessage({
    conversationId: conversation.conversation_id,
    wamid: message.wamid,
    type: message.type,
    body: message.text,
    payload: message.raw
  })
  // Reintento de Meta (wamid repetido): ese mensaje ya tuvo su respuesta.
  if (!stored) return
  const reply = pickAutomaticReply(conversation)
  if (!reply) return
  // Sin await: subir y mandar archivos tarda segundos y Meta reintenta el
  // webhook si no recibe el 200 rápido. El error no se pierde: queda en el log.
  reply({ conversation, phoneNumberId: message.phoneNumberId })
    .catch(err => log.error({ err, conversationId: conversation.conversation_id }, 'WhatsApp: falló la respuesta automática'))
}

function pickAutomaticReply (conversation) {
  if (shouldSendProgramInfo({ conversation, now: new Date() })) return sendProgramInfo
  if (conversation.status === 'HANDED_OFF' && canSendPostHandoffReply({
    handoffSentAt: conversation.handoff_sent_at, postHandoffReplyAt: conversation.post_handoff_reply_at
  })) return sendAdvisorLink
  return null
}

async function sendProgramInfo ({ conversation, phoneNumberId }) {
  if (!await repo.claimFirstReply(conversation.conversation_id)) return
  let sent
  try {
    sent = await sendProgramMedia({
      phoneNumberId,
      to: conversation.contact_phone,
      programId: conversation.program_id,
      slots: PROGRAM_INFO_SLOTS
    })
  } catch (err) {
    // Se suelta el turno para que el próximo mensaje del lead lo reintente; sin
    // esto, un token vencido dejaba al lead sin respuesta para siempre.
    // ponytail: si falló a mitad, el reintento repite los archivos que sí salieron.
    await repo.releaseFirstReply(conversation.conversation_id)
    throw err
  }
  for (const { wamid, kind, caption } of sent) {
    await repo.insertOutgoingMessage({ conversationId: conversation.conversation_id, wamid, type: kind, body: caption, sentBy: 'SCRIPT' })
  }
}

// Regla B: el lead le vuelve a escribir al bot ya derivado; recibe una vez el
// enlace de su asesora y el bot calla.
async function sendAdvisorLink ({ conversation, phoneNumberId }) {
  if (!await repo.claimPostHandoffReply(conversation.conversation_id)) return
  try {
    const advisorPhone = await repo.findAdvisorPhone(conversation.advisor_number_id)
    const full = await repo.findConversation(conversation.conversation_id)
    const body = buildAdvisorLinkText({ contactName: full.contact_name, advisorLabel: full.advisor_label, advisorPhone })
    const wamid = await cloudApi.sendMessage({ phoneNumberId, payload: buildTextMessage({ to: conversation.contact_phone, body }) })
    await repo.insertOutgoingMessage({ conversationId: conversation.conversation_id, wamid, type: 'text', body, sentBy: 'SCRIPT' })
  } catch (err) {
    await repo.releasePostHandoffReply(conversation.conversation_id)
    throw err
  }
}

// ── Derivación a la asesora (cron) ───────────────────────────────────────────
// En la hora 71 de la ventana gratis el bot manda la plantilla con el wa.me de
// la asesora del programa. La corre services/whatsapp-handoff.cron.js.
export async function runDueHandoffs ({ now = new Date(), log = console } = {}) {
  const cutoff = new Date(now.getTime() - HANDOFF_AT_HOURS * 3600_000)
  const due = await repo.listDueHandoffs(cutoff)
  let sent = 0
  for (const conversationId of due) {
    try {
      if (await handOff(conversationId)) sent++
    } catch (err) {
      log.error({ err: err.message, conversationId }, 'WhatsApp: falló la derivación')
    }
  }
  return { due: due.length, sent }
}

async function handOff (conversationId) {
  const conversation = await repo.claimHandoff(conversationId)
  if (!conversation) return false
  try {
    const payload = buildHandoffTemplate({
      to: conversation.contact_phone,
      contactName: conversation.contact_name,
      advisorLabel: conversation.advisor_label,
      programName: conversation.program_name ?? DEFAULT_PROGRAM_LABEL,
      advisorPhone: await repo.findAdvisorPhone(conversation.advisor_number_id)
    })
    const wamid = await cloudApi.sendMessage({ phoneNumberId: conversation.phone_number_id, payload })
    await repo.insertOutgoingMessage({ conversationId, wamid, type: 'template', body: `Plantilla ${HANDOFF_TEMPLATE} → ${conversation.advisor_label}`, sentBy: 'TEMPLATE' })
    return true
  } catch (err) {
    // El próximo ciclo del cron lo reintenta.
    await repo.releaseHandoff(conversationId)
    throw err
  }
}

// ── Bandeja del ERP ──────────────────────────────────────────────────────────
export async function listConversations ({ requester, status }) {
  const userId = isWhatsappLeader(requester.roles) ? null : requester.id
  return repo.listConversations({ userId, status: status ?? null })
}

export async function getConversation ({ conversationId, requester }) {
  const conversation = await visibleConversation({ conversationId, requester })
  return {
    conversation,
    messages: await repo.listMessages(conversationId),
    canReply: canReplyConversation({ conversation, userId: requester.id, roles: requester.roles }),
    windowOpen: canReplyFreeText({ lastLeadMessageAt: conversation.last_lead_message_at, now: new Date() })
  }
}

export async function replyToConversation ({ conversationId, body, requester }) {
  const conversation = await visibleConversation({ conversationId, requester })
  if (!canReplyConversation({ conversation, userId: requester.id, roles: requester.roles })) {
    throw new ForbiddenError('Solo respondes desde tu propia línea de WhatsApp.')
  }
  if (!canReplyFreeText({ lastLeadMessageAt: conversation.last_lead_message_at, now: new Date() })) {
    throw new DomainError('Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo deja mandar plantillas aprobadas.', { statusCode: 409 })
  }
  const text = body.trim()
  if (!text) throw new DomainError('Escribe un mensaje.')
  const wamid = await cloudApi.sendMessage({
    phoneNumberId: conversation.phone_number_id,
    payload: buildTextMessage({ to: conversation.contact_phone, body: text })
  })
  return repo.insertOutgoingMessage({ conversationId, wamid, type: 'text', body: text, sentBy: 'USER', userId: requester.id })
}

async function visibleConversation ({ conversationId, requester }) {
  const conversation = await repo.findConversation(conversationId)
  if (!conversation) throw new NotFoundError('Esa conversación no existe.')
  if (!canSeeConversation({ conversation, userId: requester.id, roles: requester.roles })) {
    throw new ForbiddenError('Esa conversación es de otra línea.')
  }
  return conversation
}

// ── Configuración (líderes) ──────────────────────────────────────────────────
export async function getSettings () {
  const [numbers, programAdvisors, programs, users] = await Promise.all([
    repo.listNumbers(), repo.listProgramAdvisors(), repo.listActivePrograms(), repo.listAdvisorUsers()
  ])
  // Sin sus archivos, el primer mensaje del bot falla y el lead no recibe nada.
  const missing = await missingProgramMedia(programAdvisors.map(p => p.program_id))
  return {
    numbers,
    programAdvisors: programAdvisors.map(p => ({ ...p, missing_media: missing[p.program_id] })),
    programs,
    users
  }
}

export async function saveNumber (input) {
  if (input.role === 'BOT' && input.isDefaultAdvisor) throw new DomainError('El número del bot no puede ser la asesora por defecto.')
  const saved = await repo.saveNumber(input)
  if (!saved) throw new NotFoundError('Ese número no existe.')
  return saved
}

// Frases sin vacíos ni repetidas: una frase vacía haría match con cualquier mensaje.
export async function saveProgramAdvisor ({ programId, advisorNumberId, prefillPhrases, userId }) {
  const phrases = [...new Set(prefillPhrases.map(p => p.trim()).filter(Boolean))]
  await repo.saveProgramAdvisor({ programId, advisorNumberId, prefillPhrases: phrases, userId })
}

export const deleteProgramAdvisor = ({ programId }) => repo.deleteProgramAdvisor(programId)

// ── Biblioteca de archivos por programa ──────────────────────────────────────
// Archivos de la biblioteca del programa listos para enviar, en el orden de
// `slots`. Falla ANTES de enviar nada si falta uno o no se puede mandar: medio
// bloque informativo confunde más que ninguno.
export async function prepareProgramMedia ({ programId, slots }) {
  const library = await readProgramMedia(programId)
  const problems = []
  const files = slots.map(({ slot, caption }) => {
    const file = library[slot]
    const media = file && mediaKindFor(file.filename, file.buffer.length)
    if (!media) problems.push(file ? `${file.filename}: formato no soportado o imagen > 5 MB` : `falta "${slot}"`)
    return { ...file, ...media, slot, caption }
  })
  if (problems.length) throw new Error(`Programa ${programId}: ${problems.join('; ')}`)
  return files
}

// ponytail: sube el archivo a Meta en cada envío; cachear el media id cuando el volumen lo pida.
export async function sendProgramMedia ({ phoneNumberId, to, programId, slots }) {
  const sent = []
  for (const file of await prepareProgramMedia({ programId, slots })) {
    const mediaId = await cloudApi.uploadMedia({ phoneNumberId, buffer: file.buffer, mimeType: file.mimeType, filename: file.filename })
    const payload = buildMediaMessage({ to, kind: file.kind, mediaId, caption: file.caption, filename: file.filename })
    sent.push({ wamid: await cloudApi.sendMessage({ phoneNumberId, payload }), kind: file.kind, caption: file.caption })
  }
  return sent
}
