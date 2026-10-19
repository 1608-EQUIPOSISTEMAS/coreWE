const body = (properties, required = []) => ({
  body: { type: 'object', additionalProperties: false, required, properties }
})

const id = { type: 'integer', minimum: 1 }

export const listConversationsSchema = body({
  status: { type: 'string', enum: ['BOT', 'HANDED_OFF', 'ADVISOR', 'CLOSED'] }
})

export const conversationSchema = body({ conversation_id: id }, ['conversation_id'])

// 4096 = tope de Meta para el cuerpo de un mensaje de texto.
export const replySchema = body({
  conversation_id: id,
  body: { type: 'string', minLength: 1, maxLength: 4096 }
}, ['conversation_id', 'body'])

export const saveNumberSchema = body({
  wa_number_id: id,
  phone_number_id: { type: 'string', minLength: 1, maxLength: 40 },
  // Formato wa.me: código de país y número, solo dígitos.
  display_phone: { type: 'string', pattern: '^[0-9]{8,15}$' },
  label: { type: 'string', minLength: 1, maxLength: 80 },
  role: { type: 'string', enum: ['BOT', 'ADVISOR'] },
  user_id: { type: ['integer', 'null'], minimum: 1 },
  is_default_advisor: { type: 'boolean' },
  active: { type: 'string', enum: ['Y', 'N'] }
}, ['phone_number_id', 'display_phone', 'label', 'role', 'is_default_advisor', 'active'])

export const saveProgramAdvisorSchema = body({
  program_id: id,
  advisor_number_id: id,
  prefill_phrases: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 200 } }
}, ['program_id', 'advisor_number_id', 'prefill_phrases'])

export const programSchema = body({ program_id: id }, ['program_id'])
