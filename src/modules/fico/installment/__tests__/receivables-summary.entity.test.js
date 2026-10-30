import { describe, it, expect } from 'vitest'
import { buildReceivablesSummary } from '../installment.entity.js'

describe('buildReceivablesSummary', () => {
  it('agrupa por mes y linea, separa PEN/USD y junta Minicurso con Curso', () => {
    const r = buildReceivablesSummary([
      { month: 1, program_type: 'we_program_type_course', currency: 'PEN', balance: 100.5 },
      { month: 1, program_type: 'we_program_type_minicourse', currency: 'PEN', balance: 50 },
      { month: 1, program_type: 'we_program_type_course', currency: 'USD', balance: 30 },
      { month: 2, program_type: 'we_program_type_diploma', currency: 'PEN', balance: 200 }
    ])
    const ene = r.months[0]
    expect(ene.lines.map((l) => l.label)).toEqual(['Diplomado', 'PEE', 'Esp.', 'Curso', 'Evento', 'Membresía'])
    expect(ene.lines.find((l) => l.key === 'course')).toMatchObject({ pen: 150.5, usd: 30 })
    expect(ene.total).toEqual({ pen: 150.5, usd: 30 })
    expect(r.total).toEqual({ pen: 350.5, usd: 30 })
    expect(r.months).toHaveLength(12)
  })

  it('KPIs: proyectado y recibido por moneda; deuda = total de saldos', () => {
    const r = buildReceivablesSummary([
      { month: 1, program_type: 'we_program_type_pee', currency: 'PEN', projected: 300, received: 200, balance: 100 },
      { month: 2, program_type: 'we_program_type_pee', currency: 'USD', projected: 50, received: 50, balance: 0 }
    ])
    expect(r.kpis).toEqual({
      projected: { pen: 300, usd: 50 },
      received: { pen: 200, usd: 50 },
      debt: { pen: 100, usd: 0 }
    })
  })

  it('un tipo desconocido va a "Otros" y solo aparece si tiene saldo', () => {
    const r = buildReceivablesSummary([{ month: 3, program_type: '', currency: 'PEN', balance: 10 }])
    expect(r.months[2].lines.at(-1)).toMatchObject({ label: 'Otros', pen: 10 })
    expect(r.months[0].lines.some((l) => l.key === 'other')).toBe(false)
  })
})
