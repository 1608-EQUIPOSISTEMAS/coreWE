import { describe, it, expect, vi, beforeEach } from 'vitest'

const consultarAvanceDesdeSlack = vi.fn()
const createTicketFromSlack = vi.fn()
const postearMensaje = vi.fn()
const interpretarMensaje = vi.fn()
const leerHistorialDm = vi.fn()

// Sin la espera anti-rafaga: cada test procesa su mensaje en el acto.
process.env.TICKETS_SLACK_ESPERA_MS = '0'

vi.mock('../../tickets.usecases.js', () => ({ consultarAvanceDesdeSlack, createTicketFromSlack }))
vi.mock('../../../../shared/adapters/slack/tickets-slack.adapter.js', () => ({ postearMensaje, leerHistorialDm }))
vi.mock('../slack.ai.js', () => ({ interpretarConversacion: interpretarMensaje }))

const { eventsHandler, esDmDePersona, yaProcesado } = await import('../slack.events.js')
const { bloquesDePreguntas } = await import('../slack.blocks.js')

const replyDoble = () => {
  const reply = { payload: null }
  reply.code = vi.fn(() => reply)
  reply.send = vi.fn((p) => { reply.payload = p; return reply })
  return reply
}

// Cada test estrena event_id: la deduplicacion es un Map vivo entre tests.
let n = 0
const evento = (extra = {}) => ({
  type: 'message', channel_type: 'im', channel: 'D1', user: 'U1', ts: '1.1',
  text: 'el ERP no carga el reporte', ...extra
})
const callback = (ev = evento()) => ({ type: 'event_callback', event_id: `Ev${++n}`, event: ev })

const ultimoTexto = () => postearMensaje.mock.calls.at(-1)[1].text

beforeEach(() => {
  vi.clearAllMocks()
  interpretarMensaje.mockResolvedValue({ intencion: 'TICKET', titulo: 'El ERP no carga', ticketRef: null, preguntas: [] })
  leerHistorialDm.mockResolvedValue([])
})

describe('esDmDePersona', () => {
  it('acepta un DM normal', () => {
    expect(esDmDePersona(evento())).toBe(true)
  })

  it('rechaza lo que postea el propio bot', () => {
    // Sin esto el bot se contestaria a si mismo para siempre: escucha el mismo
    // DM en el que responde.
    expect(esDmDePersona(evento({ bot_id: 'B1' }))).toBe(false)
    expect(esDmDePersona(evento({ subtype: 'bot_message' }))).toBe(false)
  })

  it('rechaza ediciones y borrados', () => {
    expect(esDmDePersona(evento({ subtype: 'message_changed' }))).toBe(false)
  })

  it('acepta un DM con imágenes adjuntas (file_share)', () => {
    const files = [{ id: 'F1', name: 'captura.png', mimetype: 'image/png', size: 1000 }]
    expect(esDmDePersona(evento({ subtype: 'file_share', files }))).toBe(true)
    expect(esDmDePersona(evento({ subtype: 'file_share', files, text: '' }))).toBe(true)
  })

  it('las imágenes viajan al borrador para adjuntarse al ticket', async () => {
    const files = [
      { id: 'F1', name: 'captura.png', mimetype: 'image/png', size: 1000 },
      { id: 'F2', name: 'video.mp4', mimetype: 'video/mp4', size: 1000 }
    ]
    eventsHandler({ body: callback(evento({ subtype: 'file_share', files })), headers: {} }, replyDoble())
    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    const boton = postearMensaje.mock.calls.at(-1)[1].blocks.find(b => b.type === 'actions').elements[0]
    expect(JSON.parse(boton.value).archivos).toEqual(['F1'])
  })

  it('solo imágenes, sin descripción: pide que cuente qué pasó', async () => {
    const files = [{ id: 'F1', name: 'captura.png', mimetype: 'image/png', size: 1000 }]
    eventsHandler({ body: callback(evento({ subtype: 'file_share', files, text: '' })), headers: {} }, replyDoble())
    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    expect(ultimoTexto()).toMatch(/qué pasó/)
    expect(interpretarMensaje).not.toHaveBeenCalled()
  })

  it('rechaza las respuestas dentro del hilo de un ticket', () => {
    expect(esDmDePersona(evento({ thread_ts: '0.9' }))).toBe(false)
  })

  it('acepta el mensaje raíz aunque traiga thread_ts igual a su ts', () => {
    expect(esDmDePersona(evento({ thread_ts: '1.1' }))).toBe(true)
  })

  it('rechaza lo que no es un DM', () => {
    expect(esDmDePersona(evento({ channel_type: 'channel' }))).toBe(false)
    expect(esDmDePersona({ type: 'reaction_added' })).toBe(false)
  })

  it('rechaza un mensaje sin texto', () => {
    expect(esDmDePersona(evento({ text: '   ' }))).toBe(false)
  })
})

describe('yaProcesado', () => {
  it('la primera vez pasa, la segunda no', () => {
    expect(yaProcesado('EvUnico')).toBe(false)
    expect(yaProcesado('EvUnico')).toBe(true)
  })

  it('sin id no deduplica nada', () => {
    expect(yaProcesado(undefined)).toBe(false)
  })
})

describe('eventsHandler', () => {
  it('contesta el challenge cuando Slack da de alta el endpoint', () => {
    const reply = replyDoble()
    eventsHandler({ body: { type: 'url_verification', challenge: 'abc' }, headers: {} }, reply)
    expect(reply.payload).toEqual({ challenge: 'abc' })
  })

  it('responde el ACK antes de ponerse a trabajar', () => {
    interpretarMensaje.mockImplementation(() => new Promise(() => {}))
    const reply = replyDoble()

    eventsHandler({ body: callback(), headers: {} }, reply)

    expect(reply.code).toHaveBeenCalledWith(200)
  })

  it('un reintento de Slack no vuelve a procesar el mensaje', () => {
    // El ACK se perdio, pero el trabajo pudo haber salido: repetirlo duplicaria
    // el ticket.
    eventsHandler({ body: callback(), headers: { 'x-slack-retry-num': '1' } }, replyDoble())
    expect(interpretarMensaje).not.toHaveBeenCalled()
  })

  it('el mismo event_id dos veces se procesa una sola vez', async () => {
    const body = callback()
    eventsHandler({ body, headers: {} }, replyDoble())
    eventsHandler({ body, headers: {} }, replyDoble())

    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    expect(interpretarMensaje).toHaveBeenCalledTimes(1)
  })

  it('con intención TICKET propone el borrador con botones', async () => {
    eventsHandler({ body: callback(), headers: {} }, replyDoble())

    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    const [canal, payload] = postearMensaje.mock.calls[0]
    expect(canal).toBe('D1')
    expect(payload.blocks.some(b => b.type === 'actions')).toBe(true)
  })

  it('con intención OTRO manda a comentar dentro del ERP, sin crear nada', async () => {
    interpretarMensaje.mockResolvedValue({ intencion: 'OTRO', titulo: '', ticketRef: null, preguntas: [] })

    eventsHandler({ body: callback(), headers: {} }, replyDoble())

    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    expect(ultimoTexto()).toMatch(/dentro del ERP/)
    expect(postearMensaje.mock.calls[0][1].blocks.some(b => b.type === 'actions')).toBe(false)
  })

  it('un mensaje demasiado corto pide detalle en vez de abrir un ticket vacío', async () => {
    interpretarMensaje.mockResolvedValue({ intencion: 'TICKET', titulo: 'ayuda', ticketRef: null, preguntas: [] })

    eventsHandler({ body: callback(evento({ text: 'ayuda' })), headers: {} }, replyDoble())

    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    expect(ultimoTexto()).toMatch(/no me alcanza/i)
  })

  it('con intención AVANCE responde con datos de la BD, no del modelo', async () => {
    interpretarMensaje.mockResolvedValue({ intencion: 'AVANCE', titulo: '', ticketRef: 42, preguntas: [] })
    consultarAvanceDesdeSlack.mockResolvedValue({
      ticket: { ticket_id: 42, title: 'No carga', status: 'EN_PROGRESO', priority: 'ALTA', asignado: 'Ana', comentarios: 0 },
      activos: []
    })

    eventsHandler({ body: callback(), headers: {} }, replyDoble())

    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    expect(ultimoTexto()).toMatch(/#00042/)
    expect(ultimoTexto()).toMatch(/En progreso/)
    expect(ultimoTexto()).toMatch(/Ana/)
  })

  it('un ticket que no es suyo no se confirma ni se niega con detalles', async () => {
    interpretarMensaje.mockResolvedValue({ intencion: 'AVANCE', titulo: '', ticketRef: 99, preguntas: [] })
    consultarAvanceDesdeSlack.mockResolvedValue({ ticket: null, activos: [] })

    eventsHandler({ body: callback(), headers: {} }, replyDoble())

    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    expect(ultimoTexto()).toMatch(/No encontré el ticket #00099/)
  })

  it('sin número de ticket lista los activos del usuario', async () => {
    interpretarMensaje.mockResolvedValue({ intencion: 'AVANCE', titulo: '', ticketRef: null, preguntas: [] })
    consultarAvanceDesdeSlack.mockResolvedValue({
      ticket: null,
      activos: [{ ticket_id: 7, title: 'Pago no se registró', status: 'ABIERTO' }]
    })

    eventsHandler({ body: callback(), headers: {} }, replyDoble())

    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    expect(ultimoTexto()).toMatch(/#00007/)
  })

  it('un error de dominio se muestra tal cual: está escrito para leerse', async () => {
    const err = new Error('No encontramos una cuenta activa del ERP con ese correo')
    err.expose = true
    interpretarMensaje.mockRejectedValue(err)

    eventsHandler({ body: callback(), headers: {} }, replyDoble())

    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    expect(ultimoTexto()).toMatch(/cuenta activa/)
  })

  it('un error inesperado se enmascara: los detalles van al log', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    interpretarMensaje.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:5432'))

    eventsHandler({ body: callback(), headers: {} }, replyDoble())

    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    expect(ultimoTexto()).not.toMatch(/ECONNREFUSED/)
  })
})

describe('entrevista antes del borrador', () => {
  const botonDe = payload => payload.blocks.find(b => b.type === 'actions').elements[0]

  it('si al reporte le falta contexto, pregunta en vez de proponer el borrador', async () => {
    interpretarMensaje.mockResolvedValue({
      intencion: 'TICKET', titulo: 'No carga', ticketRef: null, preguntas: ['¿En qué módulo?', '¿Desde cuándo?']
    })

    eventsHandler({ body: callback(), headers: {} }, replyDoble())

    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    const payload = postearMensaje.mock.calls[0][1]
    expect(payload.blocks.find(b => b.block_id === 'tk_preguntas').text.text).toMatch(/1\. ¿En qué módulo\?\n2\. ¿Desde cuándo\?/)
    expect(JSON.parse(botonDe(payload).value)).toEqual({
      ronda: 1, inicio: '1.1', preguntas: ['¿En qué módulo?', '¿Desde cuándo?']
    })
  })

  it('la respuesta se lee junto con el mensaje inicial y termina en el borrador', async () => {
    const ahora = Math.floor(Date.now() / 1000)
    leerHistorialDm.mockResolvedValue([
      { type: 'message', bot_id: 'B1', ts: `${ahora - 30}.2`, ...bloquesDePreguntas({ preguntas: ['¿Qué alumno?'], ronda: 1, inicio: `${ahora - 60}.1` }) },
      { type: 'message', user: 'U1', ts: `${ahora - 60}.1`, text: 'no puedo matricular a un alumno' }
    ])

    eventsHandler({ body: callback(evento({ ts: `${ahora}.3`, text: 'el 4521' })), headers: {} }, replyDoble())

    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    const turnos = interpretarMensaje.mock.calls[0][0]
    expect(turnos.map(t => t.rol)).toEqual(['usuario', 'bot', 'usuario'])
    expect(interpretarMensaje.mock.calls[0][1]).toEqual({ permitirPreguntas: true })

    const problema = postearMensaje.mock.calls[0][1].blocks.find(b => b.block_id === 'tk_problema').text.text
    expect(problema).toMatch(/no puedo matricular a un alumno\n\nP: ¿Qué alumno\?\nR: el 4521/)
  })

  it('dentro de la entrevista una respuesta corta no se rechaza por corta', async () => {
    const ahora = Math.floor(Date.now() / 1000)
    leerHistorialDm.mockResolvedValue([
      { type: 'message', bot_id: 'B1', ts: `${ahora - 30}.2`, ...bloquesDePreguntas({ preguntas: ['¿Sale error?'], ronda: 1, inicio: `${ahora - 60}.1` }) },
      { type: 'message', user: 'U1', ts: `${ahora - 60}.1`, text: 'el reporte de cobranza no carga' }
    ])
    interpretarMensaje.mockResolvedValue({ intencion: 'OTRO', titulo: 'Reporte de cobranza no carga', ticketRef: null, preguntas: [] })

    eventsHandler({ body: callback(evento({ ts: `${ahora}.3`, text: 'no' })), headers: {} }, replyDoble())

    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    expect(postearMensaje.mock.calls[0][1].blocks.some(b => b.block_id === 'tk_titulo')).toBe(true)
  })

  it('agotadas las rondas, ya no permite preguntar', async () => {
    const ahora = Math.floor(Date.now() / 1000)
    leerHistorialDm.mockResolvedValue([
      { type: 'message', bot_id: 'B1', ts: `${ahora - 30}.2`, ...bloquesDePreguntas({ preguntas: ['¿x?'], ronda: 2, inicio: `${ahora - 90}.1` }) },
      { type: 'message', user: 'U1', ts: `${ahora - 90}.1`, text: 'el reporte de cobranza no carga' }
    ])

    eventsHandler({ body: callback(evento({ ts: `${ahora}.3`, text: 'eso' })), headers: {} }, replyDoble())

    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    expect(interpretarMensaje.mock.calls[0][1]).toEqual({ permitirPreguntas: false })
  })

  it('sin historial disponible no pregunta: no podría releer las respuestas', async () => {
    leerHistorialDm.mockResolvedValue(null)

    eventsHandler({ body: callback(), headers: {} }, replyDoble())

    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    expect(interpretarMensaje.mock.calls[0][1]).toEqual({ permitirPreguntas: false })
  })
})

describe('creación automática', () => {
  it('con el reporte completo crea el ticket sin borrador ni botones', async () => {
    interpretarMensaje.mockResolvedValue({
      intencion: 'TICKET', titulo: 'No carga el reporte de cobranza', ticketRef: null, preguntas: [], completo: true
    })
    createTicketFromSlack.mockResolvedValue({ ticket_id: 77, title: 'No carga el reporte de cobranza' })
    const files = [{ id: 'F1', name: 'captura.png', mimetype: 'image/png', size: 1000 }]

    eventsHandler({
      body: callback(evento({
        subtype: 'file_share',
        files,
        text: 'desde ayer el <https://erp.test/cobranza|reporte> de cobranza no carga, a todo el equipo'
      })),
      headers: {}
    }, replyDoble())

    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    expect(createTicketFromSlack).toHaveBeenCalledWith({
      slackUserId: 'U1',
      titulo: 'No carga el reporte de cobranza',
      problema: 'desde ayer el reporte de cobranza no carga, a todo el equipo',
      link: 'https://erp.test/cobranza',
      archivosSlack: ['F1']
    })
    const payload = postearMensaje.mock.calls[0][1]
    expect(payload.text).toMatch(/#00077/)
    expect(payload.blocks.some(b => b.type === 'actions')).toBe(false)
  })

  it('incompleto y sin preguntas pendientes, sigue ofreciendo el borrador', async () => {
    interpretarMensaje.mockResolvedValue({ intencion: 'TICKET', titulo: 'x', ticketRef: null, preguntas: [], completo: false })

    eventsHandler({ body: callback(), headers: {} }, replyDoble())

    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    expect(createTicketFromSlack).not.toHaveBeenCalled()
    expect(postearMensaje.mock.calls[0][1].blocks.some(b => b.type === 'actions')).toBe(true)
  })

  it('si crear falla por dominio (sin cuenta en el ERP), lo dice tal cual', async () => {
    interpretarMensaje.mockResolvedValue({ intencion: 'TICKET', titulo: 'x', ticketRef: null, preguntas: [], completo: true })
    const err = new Error('No encontramos una cuenta activa del ERP con tu correo')
    err.expose = true
    createTicketFromSlack.mockRejectedValue(err)

    eventsHandler({ body: callback(), headers: {} }, replyDoble())

    await vi.waitFor(() => expect(postearMensaje).toHaveBeenCalled())
    expect(ultimoTexto()).toMatch(/cuenta activa/)
  })
})
