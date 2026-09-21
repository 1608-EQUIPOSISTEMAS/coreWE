import { describe, it, expect, vi, beforeEach } from 'vitest'

const createTicketFromSlack = vi.fn()
const reemplazarMensaje = vi.fn()

vi.mock('../../tickets.usecases.js', () => ({ createTicketFromSlack, consultarAvanceDesdeSlack: vi.fn() }))
vi.mock('../../../../shared/adapters/slack/tickets-slack.adapter.js', () => ({
  reemplazarMensaje, postearMensaje: vi.fn()
}))

const { interactionsHandler } = await import('../slack.interactions.js')
const { bloquesDeBorrador, ACCION_CREAR, ACCION_DESCARTAR } = await import('../slack.blocks.js')

const replyDoble = () => {
  const reply = {}
  reply.code = vi.fn(() => reply)
  reply.send = vi.fn(() => reply)
  return reply
}

const BORRADOR = {
  titulo: 'No carga el reporte',
  problema: 'Desde ayer el reporte de matrículas se queda cargando.',
  enlaces: ['https://erp.test/r']
}

// ts distinto por test: la proteccion contra doble clic es un Map vivo.
let n = 0
const payload = (accion, extra = {}) => JSON.stringify({
  type: 'block_actions',
  user: { id: 'U1' },
  response_url: 'https://hooks.slack.com/actions/1/2',
  actions: [{ action_id: accion }],
  message: { ts: `${++n}.0`, blocks: bloquesDeBorrador(BORRADOR).blocks },
  ...extra
})

const ultimoTexto = () => reemplazarMensaje.mock.calls.at(-1)[1]

beforeEach(() => {
  vi.clearAllMocks()
  createTicketFromSlack.mockResolvedValue({ ticket_id: 42, priority: 'ALTA' })
})

describe('interactionsHandler', () => {
  it('responde el ACK antes de crear nada', () => {
    createTicketFromSlack.mockImplementation(() => new Promise(() => {}))
    const reply = replyDoble()

    interactionsHandler({ body: { payload: payload(ACCION_CREAR) } }, reply)

    expect(reply.code).toHaveBeenCalledWith(200)
  })

  it('crear usa el borrador que viaja en el propio mensaje', async () => {
    interactionsHandler({ body: { payload: payload(ACCION_CREAR) } }, replyDoble())

    await vi.waitFor(() => expect(reemplazarMensaje).toHaveBeenCalled())
    expect(createTicketFromSlack).toHaveBeenCalledWith({
      slackUserId: 'U1',
      titulo: BORRADOR.titulo,
      problema: BORRADOR.problema,
      link: 'https://erp.test/r'
    })
    expect(ultimoTexto()).toMatch(/#00042/)
  })

  it('descartar no crea nada', async () => {
    interactionsHandler({ body: { payload: payload(ACCION_DESCARTAR) } }, replyDoble())

    await vi.waitFor(() => expect(reemplazarMensaje).toHaveBeenCalled())
    expect(createTicketFromSlack).not.toHaveBeenCalled()
    expect(ultimoTexto()).toMatch(/no creé nada/i)
  })

  it('dos clics seguidos al mismo botón crean un solo ticket', async () => {
    const mismo = { body: { payload: payload(ACCION_CREAR) } }
    interactionsHandler(mismo, replyDoble())
    interactionsHandler(mismo, replyDoble())

    await vi.waitFor(() => expect(reemplazarMensaje).toHaveBeenCalled())
    expect(createTicketFromSlack).toHaveBeenCalledTimes(1)
  })

  it('un mensaje sin los bloques esperados no revienta: pide reescribirlo', async () => {
    const roto = payload(ACCION_CREAR)
    const obj = JSON.parse(roto)
    obj.message.blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'viejo' } }]

    interactionsHandler({ body: { payload: JSON.stringify(obj) } }, replyDoble())

    await vi.waitFor(() => expect(reemplazarMensaje).toHaveBeenCalled())
    expect(createTicketFromSlack).not.toHaveBeenCalled()
    expect(ultimoTexto()).toMatch(/borrador/i)
  })

  it('un payload que no es JSON no tumba el handler', () => {
    expect(() => interactionsHandler({ body: { payload: 'no-json' } }, replyDoble())).not.toThrow()
  })

  it('ignora interacciones que no son de estos botones', async () => {
    interactionsHandler({ body: { payload: payload('otra_cosa') } }, replyDoble())

    await new Promise(r => setTimeout(r, 10))
    expect(reemplazarMensaje).not.toHaveBeenCalled()
  })

  it('un error de dominio se muestra tal cual', async () => {
    const err = new Error('No hay agentes disponibles para atender el ticket')
    err.expose = true
    createTicketFromSlack.mockRejectedValue(err)

    interactionsHandler({ body: { payload: payload(ACCION_CREAR) } }, replyDoble())

    await vi.waitFor(() => expect(reemplazarMensaje).toHaveBeenCalled())
    expect(ultimoTexto()).toMatch(/No hay agentes/)
  })
})
