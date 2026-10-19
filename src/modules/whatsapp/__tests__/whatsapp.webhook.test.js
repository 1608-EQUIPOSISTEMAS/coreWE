import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { parseWebhook } from '../whatsapp.entity.js'
import { isValidMetaSignature } from '../whatsapp.verify.js'

// Forma del webhook según la doc de la Cloud API (entry → changes → value).
const adClickWebhook = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA_ID',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '51999000111', phone_number_id: 'PNID_BOT' },
        contacts: [{ profile: { name: 'María' }, wa_id: '51999111222' }],
        messages: [
          {
            from: '51999111222',
            id: 'wamid.AAA',
            timestamp: '1760868000',
            type: 'text',
            text: { body: 'Hola, estoy en facebook, y quisiera información de la especialización en Power BI' },
            referral: { source_id: 'AD_1', source_type: 'ad', ctwa_clid: 'CLID' }
          },
          {
            from: '51999111222',
            id: 'wamid.BBB',
            timestamp: '1760868060',
            type: 'image',
            image: { id: 'MEDIA_1', mime_type: 'image/jpeg', caption: 'voucher' }
          }
        ],
        statuses: [{ id: 'wamid.OUT1', status: 'read', timestamp: '1760868100', recipient_id: '51999111222' }]
      }
    }]
  }]
}

describe('parseWebhook', () => {
  const { messages, statuses } = parseWebhook(adClickWebhook)

  it('saca el texto, el contacto, el número nuestro y el referral del anuncio', () => {
    expect(messages[0]).toMatchObject({
      phoneNumberId: 'PNID_BOT',
      from: '51999111222',
      contactName: 'María',
      wamid: 'wamid.AAA',
      type: 'text',
      referral: { source_id: 'AD_1' },
      media: null
    })
    expect(messages[0].sentAt.toISOString()).toBe('2025-10-19T10:00:00.000Z')
  })

  it('una imagen trae su media id y el caption como texto', () => {
    expect(messages[1]).toMatchObject({ type: 'image', text: 'voucher', media: { id: 'MEDIA_1', mimeType: 'image/jpeg' } })
  })

  it('los estados de los salientes van aparte', () => {
    expect(statuses).toEqual([{ wamid: 'wamid.OUT1', status: 'read', errors: null }])
  })

  it('un body raro no revienta', () => {
    expect(parseWebhook({})).toEqual({ messages: [], statuses: [] })
    expect(parseWebhook(null)).toEqual({ messages: [], statuses: [] })
  })
})

describe('isValidMetaSignature', () => {
  const appSecret = 'secreto'
  const rawBody = Buffer.from(JSON.stringify(adClickWebhook))
  const sign = body => `sha256=${crypto.createHmac('sha256', appSecret).update(body).digest('hex')}`

  it('acepta la firma correcta', () => {
    expect(isValidMetaSignature({ rawBody, signature: sign(rawBody), appSecret })).toBe(true)
  })
  it('rechaza un body alterado o sin firma', () => {
    expect(isValidMetaSignature({ rawBody: Buffer.from('{}'), signature: sign(rawBody), appSecret })).toBe(false)
    expect(isValidMetaSignature({ rawBody, signature: undefined, appSecret })).toBe(false)
    expect(isValidMetaSignature({ rawBody, signature: 'sha256=corta', appSecret })).toBe(false)
  })
})
