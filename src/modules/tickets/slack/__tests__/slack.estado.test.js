import { describe, it, expect } from 'vitest'
import { textoDeEstado } from '../slack.estado.js'

const ACTIVOS = [
  { ticket_id: 42, title: 'No carga el reporte', status: 'EN_PROGRESO', priority: 'ALTA', asignado: 'Ana' },
  { ticket_id: 7, title: 'Pago no se registró', status: 'ABIERTO', priority: 'MEDIA', asignado: null }
]

describe('textoDeEstado', () => {
  it('lista cada ticket abierto con número, estado, prioridad y quién lo atiende', () => {
    const texto = textoDeEstado(ACTIVOS)
    expect(texto).toMatch(/Tus tickets abiertos \(2\)/)
    expect(texto).toMatch(/#00042\* — No carga el reporte\n.*En progreso · Prioridad ALTA · Atiende: Ana/)
    expect(texto).toMatch(/#00007\* — Pago no se registró\n.*Abierto, esperando que lo tomen · Prioridad MEDIA · Atiende: aún sin asignar/)
  })

  it('sin tickets abiertos lo dice', () => {
    expect(textoDeEstado([])).toMatch(/No tienes tickets abiertos/)
  })
})
