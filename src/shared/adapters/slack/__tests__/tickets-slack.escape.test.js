import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  notificarTicketCreado, notificarSlaIncumplido, avisarComentarioNuevo
} from '../tickets-slack.adapter.js'

// Se captura lo que saldria a Slack con un fetch doblado: ni red ni Slack real.
let enviados
beforeEach(() => {
  enviados = []
  vi.stubEnv('SLACK_WEBHOOK_URL', 'https://hooks.example.test/x')
  vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
  vi.stubGlobal('fetch', vi.fn(async (url, opciones) => {
    enviados.push(JSON.parse(opciones.body))
    return { ok: true, json: async () => ({ ok: true, channel: 'D1', ts: '1.1' }), text: async () => '' }
  }))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const TICKET = {
  ticket_id: 13,
  title: '<!channel> no carga & <b>',
  priority: 'ALTA',
  asignado: null,
  area: 'Comercial',
  slack_channel_id: 'D1',
  // 15:28 UTC = 10:28 en Lima.
  registration_date: '2026-10-07T15:28:00Z'
}

describe('avisos de Slack: texto del usuario escapado y hora de Lima', () => {
  it('un título no puede mencionar al canal ni romper el formato', async () => {
    await notificarTicketCreado(TICKET)
    const json = JSON.stringify(enviados[0])
    expect(json).not.toContain('<!channel>')
    expect(enviados[0].blocks[1].text.text).toBe('*&lt;!channel&gt; no carga &amp; &lt;b&gt;*')
    expect(enviados[0].text).toContain('&lt;!channel&gt;')
  })

  it('la fecha sale en hora de Lima aunque el servidor corra en UTC', async () => {
    await notificarTicketCreado(TICKET)
    expect(enviados[0].blocks[3].fields[3].text).toMatch(/10:28/)
  })

  it('el aviso de SLA vencido también escapa el título y usa la hora de Lima', async () => {
    await notificarSlaIncumplido(TICKET, 'respuesta', '2026-10-07T15:43:00Z')
    const json = JSON.stringify(enviados[0])
    expect(json).not.toContain('<!channel>')
    expect(json).toMatch(/10:43/)
  })

  it('el comentario replicado en el DM se escapa', async () => {
    await avisarComentarioNuevo(TICKET, 'Ana <!here>', 'mira <!channel> esto')
    const json = JSON.stringify(enviados[0])
    expect(json).not.toContain('<!channel>')
    expect(json).not.toContain('<!here>')
    expect(json).toContain('&lt;!channel&gt;')
  })
})
