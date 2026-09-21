import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const generarJson = vi.fn()
const geminiConfigurado = vi.fn(() => true)

vi.mock('../../../../shared/adapters/ai/gemini.adapter.js', () => ({ generarJson, geminiConfigurado }))

const { interpretarMensaje } = await import('../slack.ai.js')

beforeEach(() => {
  vi.clearAllMocks()
  geminiConfigurado.mockReturnValue(true)
})
afterEach(() => vi.restoreAllMocks())

describe('interpretarMensaje', () => {
  it('devuelve lo que clasificó el modelo', async () => {
    generarJson.mockResolvedValue({ intencion: 'TICKET', titulo: 'No carga el reporte', ticket_ref: 0 })

    expect(await interpretarMensaje('desde ayer el reporte no carga')).toEqual({
      intencion: 'TICKET', titulo: 'No carga el reporte', ticketRef: null, porIa: true
    })
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
