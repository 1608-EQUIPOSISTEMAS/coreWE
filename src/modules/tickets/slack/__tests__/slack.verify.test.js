import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import { verificarFirmaSlack } from '../slack.verify.js'

// La firma es lo UNICO que autentica el slash command: no hay JWT detras. Si
// esto se rompe, cualquiera que conozca la URL crea tickets a nombre de quien
// quiera. Por eso se prueban tambien los caminos de rechazo.

const SECRET = 'un-signing-secret-de-prueba'

const firmar = (body, timestamp, secret = SECRET) =>
  `v0=${crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`

function pedido (body, { timestamp = Math.floor(Date.now() / 1000), firma, conRawBody = true } = {}) {
  return {
    headers: {
      'x-slack-request-timestamp': String(timestamp),
      'x-slack-signature': firma ?? firmar(body, timestamp)
    },
    rawBody: conRawBody ? Buffer.from(body) : undefined
  }
}

// reply.code(n).send(x) encadenado, como Fastify.
function replyDoble () {
  const reply = { statusCode: null, payload: null }
  reply.code = vi.fn((n) => { reply.statusCode = n; return reply })
  reply.send = vi.fn((p) => { reply.payload = p; return reply })
  return reply
}

beforeEach(() => vi.stubEnv('SLACK_SIGNING_SECRET', SECRET))
afterEach(() => vi.unstubAllEnvs())

describe('verificarFirmaSlack', () => {
  it('deja pasar un request legitimo', async () => {
    const reply = replyDoble()
    await verificarFirmaSlack(pedido('command=/ticket&text=hola'), reply)
    expect(reply.code).not.toHaveBeenCalled()
  })

  it('rechaza una firma que no corresponde al cuerpo', async () => {
    const reply = replyDoble()
    const req = pedido('command=/ticket&text=hola')
    req.rawBody = Buffer.from('command=/ticket&text=OTRA COSA')

    await verificarFirmaSlack(req, reply)

    expect(reply.statusCode).toBe(401)
    expect(reply.payload.message).toMatch(/inválida/i)
  })

  it('rechaza una firma hecha con otro secreto', async () => {
    const reply = replyDoble()
    const body = 'command=/ticket'
    const ts = Math.floor(Date.now() / 1000)

    await verificarFirmaSlack(pedido(body, { timestamp: ts, firma: firmar(body, ts, 'otro-secreto') }), reply)

    expect(reply.statusCode).toBe(401)
  })

  it('rechaza un timestamp viejo, aunque la firma sea valida (anti-replay)', async () => {
    const reply = replyDoble()
    const viejo = Math.floor(Date.now() / 1000) - 600 // 10 minutos

    await verificarFirmaSlack(pedido('command=/ticket', { timestamp: viejo }), reply)

    expect(reply.statusCode).toBe(401)
    expect(reply.payload.message).toMatch(/timestamp/i)
  })

  it('rechaza un timestamp del futuro', async () => {
    const reply = replyDoble()
    const futuro = Math.floor(Date.now() / 1000) + 600

    await verificarFirmaSlack(pedido('command=/ticket', { timestamp: futuro }), reply)

    expect(reply.statusCode).toBe(401)
  })

  it('sin cabeceras de Slack no pasa', async () => {
    const reply = replyDoble()
    await verificarFirmaSlack({ headers: {}, rawBody: Buffer.from('x') }, reply)
    expect(reply.statusCode).toBe(401)
    expect(reply.payload.message).toMatch(/falta la firma/i)
  })

  it('sin rawBody no pasa: sin el cuerpo crudo no hay nada que verificar', async () => {
    const reply = replyDoble()
    await verificarFirmaSlack(pedido('command=/ticket', { conRawBody: false }), reply)
    expect(reply.statusCode).toBe(401)
  })

  it('sin secreto configurado responde 503, no deja pasar', async () => {
    vi.stubEnv('SLACK_SIGNING_SECRET', '')
    const reply = replyDoble()

    await verificarFirmaSlack(pedido('command=/ticket'), reply)

    expect(reply.statusCode).toBe(503)
  })

  it('una firma de largo distinto no revienta timingSafeEqual', async () => {
    const reply = replyDoble()
    await verificarFirmaSlack(pedido('command=/ticket', { firma: 'v0=corta' }), reply)
    expect(reply.statusCode).toBe(401)
  })
})
