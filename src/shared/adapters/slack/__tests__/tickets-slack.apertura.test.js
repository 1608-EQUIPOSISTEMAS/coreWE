import { describe, it, expect } from 'vitest'
import { construirMensajeDeApertura, lineaDeAbiertos } from '../tickets-slack.adapter.js'

const TICKET = { ticket_id: 42, priority: 'ALTA', asignado: null }

describe('mensaje de apertura del DM', () => {
  it('la letra chica lista los tickets abiertos: número y estado', () => {
    const { blocks } = construirMensajeDeApertura(TICKET, [
      { ticket_id: 42, status: 'ABIERTO' },
      { ticket_id: 7, status: 'EN_PROGRESO' }
    ])
    const pie = blocks.at(-1)
    expect(pie.type).toBe('context')
    expect(pie.elements[0].text).toBe('*Tus tickets abiertos:*\n#00042 · Abierto\n#00007 · En progreso')
    expect(JSON.stringify(blocks)).not.toMatch(/Te voy avisando/)
  })

  it('con muchos, corta y dice cuántos más hay', () => {
    const abiertos = Array.from({ length: 12 }, (_, i) => ({ ticket_id: i + 1, status: 'ABIERTO' }))
    expect(lineaDeAbiertos(abiertos)).toMatch(/#00010 · Abierto\ny 2 más$/)
  })

  it('sin abiertos (la consulta falló) no agrega la letra chica', () => {
    const { blocks } = construirMensajeDeApertura(TICKET, [])
    expect(blocks.some(b => b.type === 'context')).toBe(false)
  })
})
