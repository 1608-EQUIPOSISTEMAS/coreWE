import * as usecases from './whatsapp.usecases.js'

export async function verifySubscriptionHandler (req, reply) {
  const challenge = usecases.verifyWebhookSubscription({
    mode: req.query['hub.mode'],
    token: req.query['hub.verify_token'],
    challenge: req.query['hub.challenge']
  })
  if (challenge === null) return reply.code(403).send({ ok: false })
  return reply.code(200).type('text/plain').send(challenge)
}

// Si algo falla, responde 500 y Meta reintenta: es seguro porque el wamid es UNIQUE.
export async function webhookHandler (req, reply) {
  await usecases.ingestWebhook(req.body, req.log)
  return reply.code(200).send({ ok: true })
}

export async function listConversationsHandler (req, reply) {
  const data = await usecases.listConversations({ requester: req.user, status: req.body.status })
  return reply.send({ ok: true, data })
}

export async function conversationHandler (req, reply) {
  const data = await usecases.getConversation({ conversationId: req.body.conversation_id, requester: req.user })
  return reply.send({ ok: true, data })
}

export async function replyHandler (req, reply) {
  const data = await usecases.replyToConversation({ conversationId: req.body.conversation_id, body: req.body.body, requester: req.user })
  return reply.send({ ok: true, data })
}

export async function settingsHandler (req, reply) {
  return reply.send({ ok: true, data: await usecases.getSettings() })
}

export async function saveNumberHandler (req, reply) {
  const b = req.body
  const data = await usecases.saveNumber({
    waNumberId: b.wa_number_id,
    phoneNumberId: b.phone_number_id,
    displayPhone: b.display_phone,
    label: b.label,
    role: b.role,
    userId: b.user_id ?? null,
    isDefaultAdvisor: b.is_default_advisor,
    active: b.active
  })
  return reply.send({ ok: true, data })
}

export async function saveProgramAdvisorHandler (req, reply) {
  await usecases.saveProgramAdvisor({
    programId: req.body.program_id,
    advisorNumberId: req.body.advisor_number_id,
    prefillPhrases: req.body.prefill_phrases,
    userId: req.user.id
  })
  return reply.send({ ok: true })
}

export async function deleteProgramAdvisorHandler (req, reply) {
  await usecases.deleteProgramAdvisor({ programId: req.body.program_id })
  return reply.send({ ok: true })
}

export async function runHandoffsHandler (req, reply) {
  return reply.send({ ok: true, data: await usecases.runDueHandoffs({ log: req.log }) })
}
