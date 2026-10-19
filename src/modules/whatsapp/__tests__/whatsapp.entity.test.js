import { describe, it, expect } from 'vitest'
import {
  nextMessageMode,
  shouldSendProgramInfo,
  canReplyFreeText,
  initialStatusFor,
  canSeeConversation,
  canReplyConversation,
  buildAdvisorLinkText,
  handoffDueAt,
  canSendPostHandoffReply,
  detectSource,
  matchProgramByPrefill,
  buildHandoffTemplate,
  mediaKindFor,
  buildMediaMessage
} from '../whatsapp.entity.js'

const OPENED = new Date('2026-10-19T10:00:00Z')
const at = hours => new Date(OPENED.getTime() + hours * 3600_000)

describe('nextMessageMode', () => {
  it('calla si ya se derivó', () => {
    expect(nextMessageMode({ windowOpenedAt: OPENED, lastLeadMessageAt: at(73), handoffSentAt: at(71), now: at(73) })).toBe('stop')
  })
  it('deriva desde la hora 71', () => {
    expect(nextMessageMode({ windowOpenedAt: OPENED, lastLeadMessageAt: at(70), handoffSentAt: null, now: at(71) })).toBe('handoff')
  })
  it('deriva aunque se haya pasado de la hora 71 (job caído)', () => {
    expect(nextMessageMode({ windowOpenedAt: OPENED, lastLeadMessageAt: at(10), handoffSentAt: null, now: at(75) })).toBe('handoff')
  })
  it('texto libre si el lead escribió hace menos de 24 h', () => {
    expect(nextMessageMode({ windowOpenedAt: OPENED, lastLeadMessageAt: at(8), handoffSentAt: null, now: at(10) })).toBe('free_text')
  })
  it('solo plantilla con 24 h o más de silencio', () => {
    expect(nextMessageMode({ windowOpenedAt: OPENED, lastLeadMessageAt: at(2), handoffSentAt: null, now: at(26) })).toBe('template')
    expect(nextMessageMode({ windowOpenedAt: OPENED, lastLeadMessageAt: at(2), handoffSentAt: null, now: at(2 + 24) })).toBe('template')
  })
  it('primer mensaje: aún no hay ventana FEP pero el lead acaba de escribir', () => {
    expect(nextMessageMode({ windowOpenedAt: null, lastLeadMessageAt: OPENED, handoffSentAt: null, now: OPENED })).toBe('free_text')
  })
})

describe('shouldSendProgramInfo', () => {
  const fresh = { status: 'BOT', window_opened_at: null, program_id: 221, last_lead_message_at: OPENED, handoff_sent_at: null }
  it('manda la info en el primer mensaje con programa reconocido', () => {
    expect(shouldSendProgramInfo({ conversation: fresh, now: at(0.01) })).toBe(true)
  })
  it('no repite si el bot ya habló', () => {
    expect(shouldSendProgramInfo({ conversation: { ...fresh, window_opened_at: OPENED }, now: at(1) })).toBe(false)
  })
  it('sin programa no adivina', () => {
    expect(shouldSendProgramInfo({ conversation: { ...fresh, program_id: null }, now: at(0.01) })).toBe(false)
  })
  it('una conversación ya derivada no vuelve al guion', () => {
    expect(shouldSendProgramInfo({ conversation: { ...fresh, status: 'HANDED_OFF' }, now: at(0.01) })).toBe(false)
  })
})

describe('canReplyFreeText', () => {
  it('dentro de las 24 h del último mensaje del lead', () => {
    expect(canReplyFreeText({ lastLeadMessageAt: OPENED, now: at(23.9) })).toBe(true)
  })
  it('a las 24 h exactas ya solo valen plantillas', () => {
    expect(canReplyFreeText({ lastLeadMessageAt: OPENED, now: at(24) })).toBe(false)
  })
  it('sin mensaje del lead no hay ventana', () => {
    expect(canReplyFreeText({ lastLeadMessageAt: null, now: OPENED })).toBe(false)
  })
})

describe('initialStatusFor', () => {
  it('la línea de una asesora no la atiende el bot', () => {
    expect(initialStatusFor('ADVISOR')).toBe('ADVISOR')
    expect(initialStatusFor('BOT')).toBe('BOT')
  })
})

describe('acceso a conversaciones', () => {
  const conversation = { number_user_id: 7, advisor_user_id: 9 }
  it('el líder ve y responde todas', () => {
    expect(canSeeConversation({ conversation, userId: 1, roles: ['LIDER_COMERCIAL'] })).toBe(true)
    expect(canReplyConversation({ conversation, userId: 1, roles: ['ADMIN'] })).toBe(true)
  })
  it('la asesora ve las de su línea y las que el bot le derivó', () => {
    expect(canSeeConversation({ conversation, userId: 7, roles: ['COMERCIAL'] })).toBe(true)
    expect(canSeeConversation({ conversation, userId: 9, roles: ['COMERCIAL'] })).toBe(true)
    expect(canSeeConversation({ conversation, userId: 5, roles: ['COMERCIAL'] })).toBe(false)
  })
  it('pero solo responde desde su propia línea', () => {
    expect(canReplyConversation({ conversation, userId: 7, roles: ['COMERCIAL'] })).toBe(true)
    expect(canReplyConversation({ conversation, userId: 9, roles: ['COMERCIAL'] })).toBe(false)
  })
})

describe('buildAdvisorLinkText', () => {
  it('lleva el wa.me de la asesora', () => {
    expect(buildAdvisorLinkText({ contactName: 'Ana', advisorLabel: 'Grecia', advisorPhone: '51920764971' }))
      .toBe('Hola Ana, ahora te atiende Grecia por su WhatsApp. Escríbele aquí 👉 https://wa.me/51920764971')
  })
})

describe('handoffDueAt', () => {
  it('es la hora 71 desde que abrió la ventana', () => {
    expect(handoffDueAt(OPENED)).toEqual(at(71))
  })
})

describe('canSendPostHandoffReply (regla B)', () => {
  it('responde una sola vez después de derivar', () => {
    expect(canSendPostHandoffReply({ handoffSentAt: at(71), postHandoffReplyAt: null })).toBe(true)
    expect(canSendPostHandoffReply({ handoffSentAt: at(71), postHandoffReplyAt: at(74) })).toBe(false)
  })
  it('no aplica si todavía no se derivó', () => {
    expect(canSendPostHandoffReply({ handoffSentAt: null, postHandoffReplyAt: null })).toBe(false)
  })
})

describe('detectSource', () => {
  it('referral manda: es anuncio de Meta', () => {
    expect(detectSource({ text: 'Hola, estoy en facebook', referral: { source_id: '1' } })).toBe('PC2')
  })
  it('reconoce PC1 y PC3 por la frase del manual, con tildes o sin ellas', () => {
    expect(detectSource({ text: 'Hola, estoy en Facebook, y quisiera información' })).toBe('PC1')
    expect(detectSource({ text: 'Hola, estoy en la WEB y me gustaría' })).toBe('PC3')
  })
  it('lo demás es DIRECT', () => {
    expect(detectSource({ text: 'buenas, info?' })).toBe('DIRECT')
  })
})

describe('matchProgramByPrefill', () => {
  const programs = [
    { program_id: 1, prefill_phrases: ['información del curso *Power BI*'] },
    { program_id: 16, prefill_phrases: ['información de la especialización en Power BI'] }
  ]
  it('gana la frase más específica', () => {
    expect(matchProgramByPrefill('Hola, estoy en facebook, y quisiera informacion de la especializacion en power bi', programs)).toBe(16)
  })
  it('null si ninguna frase aparece', () => {
    expect(matchProgramByPrefill('hola', programs)).toBeNull()
  })
})

describe('buildHandoffTemplate', () => {
  it('arma el cuerpo y el botón URL con el número de la asesora', () => {
    const payload = buildHandoffTemplate({ to: '51999111222', contactName: 'María', advisorLabel: 'Grecia', programName: 'Especialización en Power BI', advisorPhone: '51920764971' })
    expect(payload.type).toBe('template')
    expect(payload.template.components[0].parameters.map(p => p.text)).toEqual(['María', 'Grecia', 'Especialización en Power BI'])
    expect(payload.template.components[1]).toMatchObject({ sub_type: 'url', index: '0', parameters: [{ text: '51920764971' }] })
  })
})

describe('mediaKindFor', () => {
  it('imágenes y PDF sí; videos no', () => {
    expect(mediaKindFor('docente.JPG', 1000)).toEqual({ kind: 'image', mimeType: 'image/jpeg' })
    expect(mediaKindFor('brochure.pdf', 20 * 1024 * 1024)).toEqual({ kind: 'document', mimeType: 'application/pdf' })
    expect(mediaKindFor('clase.mp4', 1000)).toBeNull()
  })
  it('una imagen de más de 5 MB no se puede mandar', () => {
    expect(mediaKindFor('docente.png', 5 * 1024 * 1024 + 1)).toBeNull()
  })
})

describe('buildMediaMessage', () => {
  it('el documento lleva filename; la imagen no', () => {
    expect(buildMediaMessage({ to: '51', kind: 'document', mediaId: 'M1', caption: 'Brochure', filename: 'brochure.pdf' }))
      .toEqual({ messaging_product: 'whatsapp', to: '51', type: 'document', document: { id: 'M1', caption: 'Brochure', filename: 'brochure.pdf' } })
    expect(buildMediaMessage({ to: '51', kind: 'image', mediaId: 'M2', filename: 'docente.jpg' }).image).toEqual({ id: 'M2' })
  })
})
