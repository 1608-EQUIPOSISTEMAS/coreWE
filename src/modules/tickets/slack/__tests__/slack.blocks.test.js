import { describe, it, expect } from 'vitest'
import { bloquesDePreguntas, leerEstadoDeMensaje, leerPreguntasDeMensaje } from '../slack.blocks.js'

describe('bloquesDePreguntas', () => {
  it('no trae botones: el ticket ya no se confirma con uno', () => {
    const mensaje = bloquesDePreguntas({ preguntas: ['¿En qué módulo?'], ronda: 1, inicio: '100.1' })
    expect(mensaje.blocks.some(b => b.type === 'actions')).toBe(false)
  })

  it('el estado viaja sin boton y se relee igual', () => {
    const mensaje = bloquesDePreguntas({ preguntas: ['¿En qué módulo?', '¿Desde cuándo?'], ronda: 2, inicio: '100.1' })
    expect(leerEstadoDeMensaje(mensaje)).toEqual({ ronda: 2, inicio: '100.1' })
    expect(leerPreguntasDeMensaje(mensaje)).toEqual(['¿En qué módulo?', '¿Desde cuándo?'])
  })

  it('sobrevive a los caracteres que Slack escapa en las preguntas', () => {
    const mensaje = bloquesDePreguntas({ preguntas: ['¿Sale <NullPointer> al guardar?'], ronda: 1, inicio: '1.1' })
    expect(leerPreguntasDeMensaje(mensaje)).toEqual(['¿Sale <NullPointer> al guardar?'])
  })
})

describe('leerEstadoDeMensaje', () => {
  it('un mensaje con otra forma (de una version anterior) devuelve null', () => {
    expect(leerEstadoDeMensaje({ blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'hola' } }] })).toBeNull()
    expect(leerEstadoDeMensaje(undefined)).toBeNull()
  })
})

describe('leerPreguntasDeMensaje', () => {
  it('sin el bloque de preguntas devuelve lista vacia', () => {
    expect(leerPreguntasDeMensaje({ blocks: [] })).toEqual([])
  })
})
