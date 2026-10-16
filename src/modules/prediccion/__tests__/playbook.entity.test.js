import { describe, it, expect } from 'vitest'
import { buildPlaybook } from '../playbook.entity.js'
import { MIN_SAMPLE } from '../prediccion.entity.js'

const program = { program_id: 27, program_name: 'POWER BI', tier: 'TOP' }
const destinos = [
  { program_id: 27, program_name: 'POWER BI', is_membership: false, compradores: 30 },
  { program_id: 168, program_name: 'MEMBRESIA PLUS', is_membership: true, compradores: 5 },
  { program_id: 18, program_name: 'EXCEL INTERMEDIO', is_membership: false, compradores: 4 },
  { program_id: 22, program_name: 'ESP. EXCEL', is_membership: false, compradores: 2 },
  { program_id: 99, program_name: 'OTRO', is_membership: false, compradores: 1 }
]
// Power BI medido 15/10/26: 380 nuevos, 42 compraron.
const stats = (over = {}) => ({
  consultaron: 380, compraron: 42, mediana_dias: 2,
  dia_0: 12, dias_1_3: 12, dias_4_14: 6, en_cuotas: 7, estudiantes: 21, ...over
})

describe('buildPlaybook', () => {
  it('conversion y cuantas veces el promedio de una consulta (8%)', () => {
    expect(buildPlaybook({ program, stats: stats(), destinations: destinos, detail: null }))
      .toMatchObject({ conversion: 11.1, vecesElPromedio: 1.4, muestra: 380, medianaDias: 2 })
  })

  it('cuando compran: tramos que suman 100% de los compradores', () => {
    const m = buildPlaybook({ program, stats: stats(), destinations: destinos, detail: null })
    expect(m.cuando.map((t) => t.pct)).toEqual([28.6, 28.6, 14.3, 28.6])
  })

  it('de los que siguen sin comprar al dia 14, cuantos compran despues', () => {
    // 12 compran despues del dia 14, de 380 - 30 que seguian sin comprar.
    expect(buildPlaybook({ program, stats: stats(), destinations: destinos, detail: null }).compranDespues).toBe(3.4)
  })

  it('separa "el mismo" de las alternativas (top 3, sin el mismo)', () => {
    const m = buildPlaybook({ program, stats: stats(), destinations: destinos, detail: null })
    expect(m.mismo).toBe(71.4)
    expect(m.alternativas.map((a) => a.programa)).toEqual(['MEMBRESIA PLUS', 'EXCEL INTERMEDIO', 'ESP. EXCEL'])
    expect(m.alternativas[0]).toMatchObject({ compradores: 5, pct: 11.9 })
    expect(m.pago).toEqual({ cuotas: 16.7, estudiantes: 50 })
  })

  it(`con menos de ${MIN_SAMPLE} nuevos dice cuantos pero no inventa % ni tramos`, () => {
    const m = buildPlaybook({ program, stats: stats({ consultaron: 12, compraron: 4 }), destinations: destinos, detail: null })
    expect(m).toMatchObject({ conversion: null, cuando: [], alternativas: [], pago: null, mismo: null })
  })

  it('si nadie compro hay conversion 0% pero no tramos ni pago', () => {
    const m = buildPlaybook({
      program, stats: stats({ consultaron: 50, compraron: 0, mediana_dias: null, dia_0: 0, dias_1_3: 0, dias_4_14: 0, en_cuotas: 0, estudiantes: 0 }), destinations: [], detail: null
    })
    expect(m).toMatchObject({ conversion: 0, cuando: [], pago: null, compranDespues: null })
  })

  it('trae la proxima edicion y el precio para cerrar', () => {
    const m = buildPlaybook({
      program, stats: stats(), destinations: destinos,
      detail: { next_start: '2026-10-29', next_code: 'E24-26', price_professional: '840.00', price_student: '750.00', reservation: '100.00' }
    })
    expect(m.edicion).toEqual({ inicio: '2026-10-29', codigo: 'E24-26' })
    expect(m.precio).toEqual({ profesional: 840, estudiante: 750, reserva: 100 })
  })
})
