import { describe, it, expect, vi, beforeEach } from 'vitest'

const createTicketFromSlack = vi.fn()
const responderResponseUrl = vi.fn()

vi.mock('../../tickets.usecases.js', () => ({ createTicketFromSlack }))
vi.mock('../../../../shared/adapters/slack/tickets-slack.adapter.js', () => ({ responderResponseUrl }))

const { parsearComando, slashCommandHandler } = await import('../slack.command.js')

const replyDoble = () => {
  const reply = { payload: null }
  reply.code = vi.fn(() => reply)
  reply.send = vi.fn((p) => { reply.payload = p; return reply })
  return reply
}

const RESPONSE_URL = 'https://hooks.slack.com/commands/1/2'

beforeEach(() => vi.clearAllMocks())

describe('parsearComando', () => {
  it('separa titulo, problema y link por barras', () => {
    expect(parsearComando('No abre el ERP | Desde hoy no entro | https://erp.test'))
      .toEqual({ titulo: 'No abre el ERP', problema: 'Desde hoy no entro', link: 'https://erp.test' })
  })

  it('el link es opcional', () => {
    expect(parsearComando('Titulo | Problema').link).toBeNull()
  })

  it('recorta los espacios de cada parte', () => {
    expect(parsearComando('  Titulo   |   Problema  ').titulo).toBe('Titulo')
  })

  it('sin barras no hay problema, y eso se detecta despues', () => {
    expect(parsearComando('solo un titulo').problema).toBeUndefined()
  })

  it('texto vacio no revienta', () => {
    expect(() => parsearComando('')).not.toThrow()
    expect(() => parsearComando(undefined)).not.toThrow()
  })
})

describe('slashCommandHandler', () => {
  it('responde el ACK de inmediato, sin esperar a crear el ticket', () => {
    // Slack corta a los 3 s: el ACK no puede depender de la BD ni de su API.
    createTicketFromSlack.mockImplementation(() => new Promise(() => {}))
    const reply = replyDoble()

    slashCommandHandler({ body: { text: 'A | Problema largo', response_url: RESPONSE_URL, user_id: 'U1' } }, reply)

    expect(reply.code).toHaveBeenCalledWith(200)
    expect(reply.payload.response_type).toBe('ephemeral')
  })

  it('con formato valido crea el ticket y avisa por la response_url', async () => {
    createTicketFromSlack.mockResolvedValue({ ticket_id: 42, priority: 'ALTA' })
    const reply = replyDoble()

    slashCommandHandler({ body: { text: 'No abre | El ERP no carga', response_url: RESPONSE_URL, user_id: 'U1' } }, reply)

    await vi.waitFor(() => expect(responderResponseUrl).toHaveBeenCalled())
    expect(createTicketFromSlack).toHaveBeenCalledWith({
      slackUserId: 'U1', titulo: 'No abre', problema: 'El ERP no carga', link: null
    })
    expect(responderResponseUrl.mock.calls[0][1]).toMatch(/#00042.*ALTA/s)
  })

  it('sin problema explica el formato en vez de fallar', async () => {
    const reply = replyDoble()

    slashCommandHandler({ body: { text: 'solo el titulo', response_url: RESPONSE_URL, user_id: 'U1' } }, reply)

    await vi.waitFor(() => expect(responderResponseUrl).toHaveBeenCalled())
    expect(responderResponseUrl.mock.calls[0][1]).toMatch(/Formato/)
    expect(createTicketFromSlack).not.toHaveBeenCalled()
  })

  it('un error de dominio se muestra tal cual: esta escrito para leerse', async () => {
    const err = new Error('No encontramos una cuenta activa con ese correo')
    err.expose = true
    createTicketFromSlack.mockRejectedValue(err)
    const reply = replyDoble()

    slashCommandHandler({ body: { text: 'A | Problema largo', response_url: RESPONSE_URL, user_id: 'U1' } }, reply)

    await vi.waitFor(() => expect(responderResponseUrl).toHaveBeenCalled())
    expect(responderResponseUrl.mock.calls[0][1]).toMatch(/cuenta activa/)
  })

  it('un error inesperado se enmascara: los detalles van al log', async () => {
    createTicketFromSlack.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:5432'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reply = replyDoble()

    slashCommandHandler({ body: { text: 'A | Problema largo', response_url: RESPONSE_URL, user_id: 'U1' } }, reply)

    await vi.waitFor(() => expect(responderResponseUrl).toHaveBeenCalled())
    const mensaje = responderResponseUrl.mock.calls[0][1]
    expect(mensaje).not.toMatch(/ECONNREFUSED/)
    expect(mensaje).toMatch(/Ocurrió un error/)
  })

  it('sin response_url no intenta contestar a ningun lado', async () => {
    const reply = replyDoble()

    slashCommandHandler({ body: { text: 'A | Problema largo', user_id: 'U1' } }, reply)

    await new Promise(r => setTimeout(r, 10))
    expect(responderResponseUrl).not.toHaveBeenCalled()
  })
})
