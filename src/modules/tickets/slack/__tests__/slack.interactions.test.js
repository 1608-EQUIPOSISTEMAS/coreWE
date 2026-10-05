import { describe, it, expect, vi, beforeEach } from 'vitest'

const responderManualDesdeSlack = vi.fn()
const reemplazarMensaje = vi.fn()

vi.mock('../../tickets.usecases.js', () => ({
  createTicketFromSlack: vi.fn(), responderManualDesdeSlack, consultarAvanceDesdeSlack: vi.fn()
}))
vi.mock('../../../../shared/adapters/slack/tickets-slack.adapter.js', () => ({
  reemplazarMensaje, reemplazarMensajeConBloques: vi.fn(), leerHistorialDm: vi.fn(), postearMensaje: vi.fn()
}))
vi.mock('../slack.ai.js', () => ({ interpretarConversacion: vi.fn() }))

const { interactionsHandler } = await import('../slack.interactions.js')
const { bloquesDeManual, ACCION_MANUAL_SI, ACCION_MANUAL_NO } = await import('../slack.blocks.js')

const replyDoble = () => {
  const reply = {}
  reply.code = vi.fn(() => reply)
  reply.send = vi.fn(() => reply)
  return reply
}

const ultimoTexto = () => reemplazarMensaje.mock.calls.at(-1)[1]

// ts distinto por test: la proteccion contra doble clic es un Map vivo.
let n = 0

beforeEach(() => {
  vi.clearAllMocks()
})

describe('interactionsHandler', () => {
  it('un payload que no es JSON no tumba el handler', () => {
    expect(() => interactionsHandler({ body: { payload: 'no-json' } }, replyDoble())).not.toThrow()
  })

  it('ignora interacciones que no son de estos botones', async () => {
    const payload = JSON.stringify({
      type: 'block_actions', actions: [{ action_id: 'otra_cosa' }], message: { ts: `${++n}.0` }
    })
    interactionsHandler({ body: { payload } }, replyDoble())

    await new Promise(r => setTimeout(r, 10))
    expect(reemplazarMensaje).not.toHaveBeenCalled()
  })

  describe('¿el manual fue suficiente?', () => {
    const manual = bloquesDeManual({
      codigo: '00042',
      documento: { title: 'Datos que no cargan', kind: 'ENLACE', url: 'https://docs.test/m' },
      minutos: 7,
      ticketId: 42
    })
    const boton = accion => manual.blocks.find(b => b.type === 'actions').elements.find(e => e.action_id === accion)
    const pulsar = accion => JSON.stringify({
      type: 'block_actions',
      user: { id: 'U1' },
      channel: { id: 'D1' },
      response_url: 'https://hooks.slack.com/actions/1/2',
      actions: [{ action_id: accion, value: boton(accion).value }],
      message: { ts: `${++n}.0`, blocks: manual.blocks }
    })

    it('responde el ACK antes de contestar nada', () => {
      responderManualDesdeSlack.mockImplementation(() => new Promise(() => {}))
      const reply = replyDoble()

      interactionsHandler({ body: { payload: pulsar(ACCION_MANUAL_SI) } }, reply)

      expect(reply.code).toHaveBeenCalledWith(200)
    })

    it('"Sí" responde por el ticket del botón, desde su DM', async () => {
      responderManualDesdeSlack.mockResolvedValue('resuelto')

      interactionsHandler({ body: { payload: pulsar(ACCION_MANUAL_SI) } }, replyDoble())

      await vi.waitFor(() => expect(reemplazarMensaje).toHaveBeenCalled())
      expect(responderManualDesdeSlack).toHaveBeenCalledWith({ ticketId: 42, canal: 'D1', resuelto: true })
      expect(ultimoTexto()).toBe('resuelto')
    })

    it('"No" deja el ticket con el agente', async () => {
      responderManualDesdeSlack.mockResolvedValue('sigue abierto')

      interactionsHandler({ body: { payload: pulsar(ACCION_MANUAL_NO) } }, replyDoble())

      await vi.waitFor(() => expect(reemplazarMensaje).toHaveBeenCalled())
      expect(responderManualDesdeSlack).toHaveBeenCalledWith({ ticketId: 42, canal: 'D1', resuelto: false })
    })

    it('dos clics seguidos al mismo botón contestan una sola vez', async () => {
      responderManualDesdeSlack.mockResolvedValue('resuelto')
      const mismo = { body: { payload: pulsar(ACCION_MANUAL_SI) } }

      interactionsHandler(mismo, replyDoble())
      interactionsHandler(mismo, replyDoble())

      await vi.waitFor(() => expect(reemplazarMensaje).toHaveBeenCalled())
      expect(responderManualDesdeSlack).toHaveBeenCalledTimes(1)
    })

    it('un error de dominio se muestra tal cual', async () => {
      const err = new Error('No hay agentes disponibles para atender el ticket')
      err.expose = true
      responderManualDesdeSlack.mockRejectedValue(err)

      interactionsHandler({ body: { payload: pulsar(ACCION_MANUAL_SI) } }, replyDoble())

      await vi.waitFor(() => expect(reemplazarMensaje).toHaveBeenCalled())
      expect(ultimoTexto()).toMatch(/No hay agentes/)
    })

    it('el mensaje hace la pregunta y avisa el plazo para responder', () => {
      const texto = JSON.stringify(manual.blocks)
      expect(texto).toMatch(/Esto fue suficiente para la solución/)
      expect(texto).toMatch(/7 minutos/)
      expect(texto).toMatch(/https:\/\/docs\.test\/m/)
    })
  })
})
