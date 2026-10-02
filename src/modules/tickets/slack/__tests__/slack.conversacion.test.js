import { describe, it, expect } from 'vitest'
import {
  reconstruirConversacion, turnosDesde, componerProblema, enlacesYArchivos,
  armarBorrador, parsearEstado, VENTANA_ENTREVISTA_S, VENTANA_PENDIENTES_S
} from '../slack.conversacion.js'
import { bloquesDePreguntas } from '../slack.blocks.js'

const AHORA = 1_700_000_000

const usuario = (seg, text, extra = {}) => ({ type: 'message', user: 'U1', ts: `${AHORA - seg}.000100`, text, ...extra })
const preguntas = (seg, { ronda = 1, inicio, lista = ['¿En qué módulo?'] }) => ({
  type: 'message', bot_id: 'B1', ts: `${AHORA - seg}.000200`,
  ...bloquesDePreguntas({ preguntas: lista, ronda, inicio })
})
const otroDelBot = seg => ({ type: 'message', bot_id: 'B1', ts: `${AHORA - seg}.000300`, text: 'Ticket #00001 creado' })

describe('reconstruirConversacion', () => {
  it('sin nada antes, arranca de cero', () => {
    expect(reconstruirConversacion([], `${AHORA}.0`)).toEqual({ ronda: 0, inicio: null, turnos: [] })
  })

  it('junta los mensajes sueltos que el bot todavía no contestó', () => {
    const previos = [usuario(5, 'el reporte de ventas'), usuario(10, 'hola'), otroDelBot(600)]
    const r = reconstruirConversacion(previos, `${AHORA}.0`)
    expect(r.ronda).toBe(0)
    expect(r.turnos.map(t => t.texto)).toEqual(['hola', 'el reporte de ventas'])
    expect(r.inicio).toBe(previos[1].ts)
  })

  it('no arrastra mensajes viejos sin respuesta', () => {
    const r = reconstruirConversacion([usuario(VENTANA_PENDIENTES_S + 60, 'algo de ayer')], `${AHORA}.0`)
    expect(r.turnos).toEqual([])
  })

  it('si lo último del bot fueron preguntas, devuelve la entrevista desde su inicio', () => {
    const inicial = usuario(120, 'no puedo matricular')
    const previos = [preguntas(60, { inicio: inicial.ts }), inicial, otroDelBot(3000)]
    const r = reconstruirConversacion(previos, `${AHORA}.0`)
    expect(r.ronda).toBe(1)
    expect(r.inicio).toBe(inicial.ts)
    expect(r.turnos.map(t => t.rol)).toEqual(['usuario', 'bot'])
    expect(r.turnos[1].preguntas).toEqual(['¿En qué módulo?'])
  })

  it('una entrevista abandonada hace rato ya no cuenta', () => {
    const inicial = usuario(VENTANA_ENTREVISTA_S + 200, 'no puedo matricular')
    const previos = [preguntas(VENTANA_ENTREVISTA_S + 100, { inicio: inicial.ts }), inicial]
    expect(reconstruirConversacion(previos, `${AHORA}.0`).ronda).toBe(0)
  })

  it('después de un borrador u otro mensaje del bot, arranca de cero', () => {
    const r = reconstruirConversacion([otroDelBot(30), usuario(60, 'viejo')], `${AHORA}.0`)
    expect(r).toEqual({ ronda: 0, inicio: null, turnos: [] })
  })
})

describe('turnosDesde', () => {
  it('ignora lo anterior al inicio y los avisos del bot que caen en medio', () => {
    const inicial = usuario(100, 'no carga')
    const mensajes = [usuario(10, 'en ventas'), otroDelBot(30), preguntas(50, { inicio: inicial.ts }), inicial, usuario(500, 'viejo')]
    expect(turnosDesde(mensajes, inicial.ts).map(t => t.texto ?? 'P')).toEqual(['no carga', 'P', 'en ventas'])
  })
})

describe('componerProblema', () => {
  it('deja el texto del usuario tal cual, con cada ronda de preguntas y su respuesta', () => {
    const problema = componerProblema([
      { rol: 'usuario', texto: 'No puedo matricular.' },
      { rol: 'bot', preguntas: ['¿Qué alumno?', '¿Desde cuándo?'] },
      { rol: 'usuario', texto: 'El 4521' },
      { rol: 'usuario', texto: 'desde hoy' },
      { rol: 'bot', preguntas: ['¿Sale algún error?'] }
    ])
    expect(problema).toBe(
      'No puedo matricular.\n\n' +
      'P: ¿Qué alumno?\nP: ¿Desde cuándo?\nR: El 4521\ndesde hoy\n\n' +
      'P: ¿Sale algún error?\nR: (sin respuesta)'
    )
  })
})

describe('enlacesYArchivos / armarBorrador', () => {
  it('junta enlaces y adjuntos de todos los mensajes, sin repetir', () => {
    const turnos = [
      { rol: 'usuario', texto: 'a', enlaces: ['https://x'], archivos: [{ id: 'F1', nombre: 'a.png' }] },
      { rol: 'usuario', texto: 'b', enlaces: ['https://x', 'https://y'], archivos: [{ id: 'F1', nombre: 'a.png' }, { id: 'F2', nombre: 'b.png' }] }
    ]
    expect(enlacesYArchivos(turnos)).toEqual({
      enlaces: ['https://x', 'https://y'],
      archivos: [{ id: 'F1', nombre: 'a.png' }, { id: 'F2', nombre: 'b.png' }]
    })
    expect(armarBorrador(turnos, 'T')).toMatchObject({ titulo: 'T', problema: 'a\n\nb' })
  })
})

describe('parsearEstado', () => {
  it('lee el estado del botón y rechaza lo que no tiene forma', () => {
    expect(parsearEstado(JSON.stringify({ ronda: 1, inicio: '1.1', preguntas: ['¿a?', 3] })))
      .toEqual({ ronda: 1, inicio: '1.1', preguntas: ['¿a?'] })
    expect(parsearEstado('nada')).toBeNull()
    expect(parsearEstado(JSON.stringify({ ronda: 0, inicio: '1.1' }))).toBeNull()
  })
})
