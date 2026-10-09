import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const generarJson = vi.fn()
const geminiConfigurado = vi.fn(() => true)

vi.mock('../../../../shared/adapters/ai/gemini.adapter.js', () => ({ generarJson, geminiConfigurado }))

const { interpretarMensaje, interpretarConversacion, PREGUNTA_CAPTURA } = await import('../slack.ai.js')

// Un mensaje con una imagen adjunta: sin ella, la captura se pide siempre.
const conImagen = texto => interpretarConversacion([{ rol: 'usuario', texto, archivos: [{ id: 'F1' }] }])

beforeEach(() => {
  vi.clearAllMocks()
  geminiConfigurado.mockReturnValue(true)
})
afterEach(() => vi.restoreAllMocks())

describe('interpretarMensaje', () => {
  it('devuelve lo que clasificó el modelo', async () => {
    generarJson.mockResolvedValue({ intencion: 'TICKET', titulo: 'No carga el reporte', ticket_ref: 0 })

    expect(await conImagen('desde ayer el reporte no carga')).toEqual({
      intencion: 'TICKET', titulo: 'No carga el reporte', ticketRef: null, preguntas: [], completo: false, porIa: true
    })
  })

  it('devuelve las preguntas del modelo, limpias y como máximo tres', async () => {
    generarJson.mockResolvedValue({
      intencion: 'TICKET',
      titulo: 'No carga el reporte',
      ticket_ref: 0,
      preguntas: ['¿En qué módulo?', '  ¿En  qué módulo?', '¿Desde cuándo?', 'ok', '¿Qué alumno?', '¿Captura?']
    })
    const r = await conImagen('el reporte no carga')
    expect(r.preguntas).toEqual(['¿En qué módulo?', '¿Desde cuándo?', '¿Qué alumno?'])
  })

  it('sin imagen adjunta pide la captura con su texto fijo, sin quitarle lugar a las de la guía', async () => {
    generarJson.mockResolvedValue({
      intencion: 'TICKET', titulo: 'x', ticket_ref: 0, completo: true,
      preguntas: ['¿Puedes enviar una captura?', '¿En qué módulo?', '¿Desde cuándo?', '¿Qué alumno?']
    })
    const r = await interpretarMensaje('el reporte no carga')
    expect(r.preguntas).toEqual(['¿En qué módulo?', '¿Desde cuándo?', '¿Qué alumno?', PREGUNTA_CAPTURA])
    expect(r.completo).toBe(false)

    generarJson.mockResolvedValue({ intencion: 'TICKET', titulo: 'x', ticket_ref: 0, preguntas: [], completo: true })
    expect((await interpretarMensaje('el reporte no carga')).preguntas).toEqual([PREGUNTA_CAPTURA])
  })

  it('si ya compartió enlaces, no se los vuelve a pedir', async () => {
    generarJson.mockResolvedValue({
      intencion: 'TICKET', titulo: 'x', ticket_ref: 0,
      preguntas: ['¿Ocurre en otros periodos?', '¿Podrías compartir los enlaces a las hojas de cálculo?']
    })
    const r = await interpretarConversacion([
      { rol: 'usuario', texto: 'no cuadra la base de Control de cuentas', enlaces: ['https://docs.google.com/x'], archivos: [{ id: 'F1' }] }
    ])
    expect(r.preguntas).toEqual(['¿Ocurre en otros periodos?'])
    expect(generarJson.mock.calls[0][0].texto).toMatch(/ya compartio 1 enlace/)
  })

  it('completo solo si el modelo lo afirma, hay imagen y no quedan preguntas', async () => {
    generarJson.mockResolvedValue({ intencion: 'TICKET', titulo: 'x', ticket_ref: 0, preguntas: [], completo: true })
    expect((await conImagen('el reporte no carga desde ayer, a todos')).completo).toBe(true)

    generarJson.mockResolvedValue({ intencion: 'TICKET', titulo: 'x', ticket_ref: 0, preguntas: ['¿Desde cuándo?'], completo: true })
    expect((await interpretarMensaje('el reporte no carga')).completo).toBe(false)

    // La salida del modelo no es confiable: un "true" en texto no cuenta.
    generarJson.mockResolvedValue({ intencion: 'TICKET', titulo: 'x', ticket_ref: 0, preguntas: [], completo: 'true' })
    expect((await interpretarMensaje('el reporte no carga')).completo).toBe(false)
  })

  it('una consulta de avance nunca es un ticket completo', async () => {
    generarJson.mockResolvedValue({ intencion: 'AVANCE', titulo: '', ticket_ref: 4, preguntas: [], completo: true })
    expect((await interpretarMensaje('cómo va el 4')).completo).toBe(false)
  })

  it('sin permiso para preguntar descarta las preguntas del modelo', async () => {
    generarJson.mockResolvedValue({ intencion: 'TICKET', titulo: 'x', ticket_ref: 0, preguntas: ['¿En qué módulo?'] })
    const r = await interpretarMensaje('el reporte no carga', { permitirPreguntas: false })
    expect(r.preguntas).toEqual([])
  })

  it('una consulta de avance nunca trae preguntas', async () => {
    generarJson.mockResolvedValue({ intencion: 'AVANCE', titulo: '', ticket_ref: 42, preguntas: ['¿Qué ticket?'] })
    expect((await interpretarMensaje('cómo va el 42')).preguntas).toEqual([])
  })

  it('le pasa al modelo la conversación completa con preguntas y respuestas', async () => {
    generarJson.mockResolvedValue({ intencion: 'TICKET', titulo: 'x', ticket_ref: 0, preguntas: [] })
    await interpretarConversacion([
      { rol: 'usuario', texto: 'no puedo matricular' },
      { rol: 'bot', preguntas: ['¿Qué alumno?'] },
      { rol: 'usuario', texto: 'el código 123', archivos: [{ id: 'F1' }] }
    ])
    const { texto } = generarJson.mock.calls[0][0]
    expect(texto).toMatch(/no puedo matricular[\s\S]*¿Qué alumno\?[\s\S]*el código 123/)
    expect(texto).toMatch(/1 imagen/)
  })

  it('las preguntas salen solo de guia-preguntas.md, sin sus comentarios HTML', async () => {
    generarJson.mockResolvedValue({ intencion: 'TICKET', titulo: 'x', ticket_ref: 0, preguntas: [] })
    await interpretarMensaje('no carga el reporte')
    const { instruccion } = generarJson.mock.calls[0][0]
    expect(instruccion).toContain('GUIA PARA PROPONER PREGUNTAS')
    expect(instruccion).toContain('Analiza el mensaje del usuario')
    expect(instruccion).not.toContain('Reglas para preguntar')
    expect(instruccion).not.toContain('<!--')
  })

  it('el 0 de ticket_ref significa "ninguno"', async () => {
    generarJson.mockResolvedValue({ intencion: 'AVANCE', titulo: '', ticket_ref: 0 })
    expect((await interpretarMensaje('cómo van mis tickets')).ticketRef).toBeNull()
  })

  it('si el modelo no ve el número, lo encuentra el regex', async () => {
    generarJson.mockResolvedValue({ intencion: 'AVANCE', titulo: '', ticket_ref: 0 })
    expect((await interpretarMensaje('novedades del #42?')).ticketRef).toBe(42)
  })

  it('un título larguísimo se recorta al límite de la entity', async () => {
    generarJson.mockResolvedValue({ intencion: 'TICKET', titulo: 'a'.repeat(300), ticket_ref: 0 })
    expect((await interpretarMensaje('texto')).titulo.length).toBeLessThanOrEqual(120)
  })

  it('una intención que no existe se trata como ticket, no se descarta', async () => {
    // La salida del modelo es entrada no confiable como cualquier otra.
    generarJson.mockResolvedValue({ intencion: 'INVENTADA', titulo: 'algo', ticket_ref: 0 })
    expect((await interpretarMensaje('el ERP no abre')).intencion).toBe('TICKET')
  })

  it('un TICKET sin título se titula con la primera frase', async () => {
    generarJson.mockResolvedValue({ intencion: 'TICKET', titulo: '', ticket_ref: 0 })
    const r = await interpretarMensaje('No carga el reporte. Pasa desde ayer.')
    expect(r.titulo).toBe('No carga el reporte.')
  })

  it('no le pide nada a la IA si no hay texto', async () => {
    expect((await interpretarMensaje('  ')).intencion).toBe('OTRO')
    expect(generarJson).not.toHaveBeenCalled()
  })

  describe('sin IA disponible', () => {
    it('no llama al modelo si no hay API key', async () => {
      geminiConfigurado.mockReturnValue(false)
      await interpretarMensaje('el ERP no carga')
      expect(generarJson).not.toHaveBeenCalled()
    })

    it('ante la duda ofrece crear el ticket: perderlo es peor', async () => {
      generarJson.mockResolvedValue(null)
      const r = await interpretarMensaje('desde ayer no puedo matricular a nadie')
      expect(r).toMatchObject({ intencion: 'TICKET', porIa: false })
      expect(r.titulo).toBe('desde ayer no puedo matricular a nadie')
    })

    it('reconoce una consulta de avance por sus palabras, sin modelo', async () => {
      generarJson.mockResolvedValue(null)
      expect(await interpretarMensaje('cómo va el #42')).toMatchObject({
        intencion: 'AVANCE', ticketRef: 42, porIa: false
      })
    })

    it('un número suelto sin pregunta de avance sigue siendo un ticket', async () => {
      generarJson.mockResolvedValue(null)
      expect((await interpretarMensaje('el alumno 42 no aparece en el listado')).intencion).toBe('TICKET')
    })
  })
})
