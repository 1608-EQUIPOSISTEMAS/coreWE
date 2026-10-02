import { describe, it, expect, vi, beforeEach } from 'vitest'

const createTicketFromSlack = vi.fn()
const responderManualDesdeSlack = vi.fn()
const reemplazarMensaje = vi.fn()
const reemplazarMensajeConBloques = vi.fn()
const leerHistorialDm = vi.fn()
const interpretarConversacion = vi.fn()

vi.mock('../../tickets.usecases.js', () => ({
  createTicketFromSlack, responderManualDesdeSlack, consultarAvanceDesdeSlack: vi.fn()
}))
vi.mock('../../../../shared/adapters/slack/tickets-slack.adapter.js', () => ({
  reemplazarMensaje, reemplazarMensajeConBloques, leerHistorialDm, postearMensaje: vi.fn()
}))
vi.mock('../slack.ai.js', () => ({ interpretarConversacion }))

const { interactionsHandler } = await import('../slack.interactions.js')
const {
  bloquesDeBorrador, bloquesDePreguntas, bloquesDeManual,
  ACCION_CREAR, ACCION_DESCARTAR, ACCION_OMITIR, ACCION_MANUAL_SI, ACCION_MANUAL_NO
} = await import('../slack.blocks.js')

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
      link: 'https://erp.test/r',
      archivosSlack: []
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

  describe('armar el ticket con lo que hay', () => {
    const preguntas = bloquesDePreguntas({ preguntas: ['¿Qué alumno?'], ronda: 1, inicio: '100.1' })
    const omitir = () => JSON.stringify({
      type: 'block_actions',
      user: { id: 'U1' },
      channel: { id: 'D1' },
      response_url: 'https://hooks.slack.com/actions/1/2',
      actions: [{ action_id: ACCION_OMITIR, value: preguntas.blocks.find(b => b.type === 'actions').elements[0].value }],
      message: { ts: `${++n}.0`, blocks: preguntas.blocks }
    })

    it('relee la conversación desde su inicio y reemplaza las preguntas por el borrador', async () => {
      leerHistorialDm.mockResolvedValue([
        { type: 'message', bot_id: 'B1', ts: '110.2', ...preguntas },
        { type: 'message', user: 'U1', ts: '100.1', text: 'no puedo matricular a nadie' }
      ])
      interpretarConversacion.mockResolvedValue({ intencion: 'TICKET', titulo: 'No se puede matricular', preguntas: [] })

      interactionsHandler({ body: { payload: omitir() } }, replyDoble())

      await vi.waitFor(() => expect(reemplazarMensajeConBloques).toHaveBeenCalled())
      expect(leerHistorialDm).toHaveBeenCalledWith('D1', { desde: '100.1', limite: 50 })
      expect(interpretarConversacion.mock.calls[0][1]).toEqual({ permitirPreguntas: false })
      const bloques = reemplazarMensajeConBloques.mock.calls[0][1].blocks
      expect(bloques.find(b => b.block_id === 'tk_titulo').text.text).toMatch(/No se puede matricular/)
      expect(bloques.find(b => b.block_id === 'tk_problema').text.text).toMatch(/no puedo matricular a nadie\n\nP: ¿Qué alumno\?\nR: \(sin respuesta\)/)
    })

    it('si no puede releer la conversación, pide escribirla de nuevo', async () => {
      leerHistorialDm.mockResolvedValue(null)

      interactionsHandler({ body: { payload: omitir() } }, replyDoble())

      await vi.waitFor(() => expect(reemplazarMensaje).toHaveBeenCalled())
      expect(ultimoTexto()).toMatch(/releer/)
      expect(interpretarConversacion).not.toHaveBeenCalled()
    })
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

    it('el mensaje hace la pregunta y avisa el plazo para responder', () => {
      const texto = JSON.stringify(manual.blocks)
      expect(texto).toMatch(/Esto fue suficiente para la solución/)
      expect(texto).toMatch(/7 minutos/)
      expect(texto).toMatch(/https:\/\/docs\.test\/m/)
    })
  })
})
