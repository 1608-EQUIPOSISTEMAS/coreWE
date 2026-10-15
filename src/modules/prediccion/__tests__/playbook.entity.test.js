import { describe, it, expect } from 'vitest'
import { buildPlaybook } from '../playbook.entity.js'
import { MIN_SAMPLE } from '../prediccion.entity.js'

const program = { program_id: 27, program_name: 'POWER BI', tier: 'TOP' }
const destinos = [
  { program_id: 27, program_name: 'POWER BI', is_membership: false, compradores: 30 },
  { program_id: 168, program_name: 'MEMBRESIA PLUS', is_membership: true, compradores: 5 },
  { program_id: 18, program_name: 'EXCEL INTERMEDIO', is_membership: false, compradores: 2 },
  { program_id: 22, program_name: 'ESP. EXCEL', is_membership: false, compradores: 1 },
  { program_id: 99, program_name: 'OTRO', is_membership: false, compradores: 1 }
]

describe('buildPlaybook', () => {
  it('Power BI (medido 15/10/26): conversion, velocidad y que terminan comprando', () => {
    const m = buildPlaybook({ program, stats: { consultaron: 380, compraron: 42, mediana_dias: 2, p90_dias: 48 }, destinations: destinos, detail: null })
    expect(m).toMatchObject({ conversion: 11.1, muestra: 380 })
    expect(m.velocidad).toContain('2 días: respóndele ya')
    expect(m.destinos).toHaveLength(4)
    expect(m.destinos[0]).toMatchObject({ mismo: true, pct: 71.4 })
    expect(m.destinos[1]).toMatchObject({ programa: 'MEMBRESIA PLUS', membresia: true })
  })

  it(`con menos de ${MIN_SAMPLE} nuevos dice cuantos pero no inventa % ni destinos`, () => {
    const m = buildPlaybook({ program, stats: { consultaron: 12, compraron: 4, mediana_dias: 1 }, destinations: destinos, detail: null })
    expect(m).toMatchObject({ conversion: null, velocidad: null, destinos: [] })
    expect(m.resumen).toContain('Solo 12 personas nuevas')
  })

  it('si nadie compro no hay velocidad ni destinos, pero si la conversion (0%)', () => {
    const m = buildPlaybook({ program, stats: { consultaron: 50, compraron: 0, mediana_dias: null }, destinations: [], detail: null })
    expect(m).toMatchObject({ conversion: 0, velocidad: null, destinos: [] })
  })

  it('trae la proxima edicion y el precio para cerrar', () => {
    const m = buildPlaybook({
      program,
      stats: { consultaron: 380, compraron: 42, mediana_dias: 2 },
      destinations: destinos,
      detail: { next_start: '2026-10-29', next_code: 'E24-26', price_professional: '840.00', price_student: '750.00', reservation: '100.00' }
    })
    expect(m.edicion).toEqual({ inicio: '2026-10-29', codigo: 'E24-26' })
    expect(m.precio).toEqual({ profesional: 840, estudiante: 750, reserva: 100 })
  })
})
