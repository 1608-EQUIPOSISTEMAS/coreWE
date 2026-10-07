import { describe, it, expect } from 'vitest'
import { aggregateVentasCanal } from '../dashboard.entity.js'
import { planWeeksOfMonth } from '../../plancomercial/plancomercial.entity.js'

const fila = (cod, dia, tipo, canal, c, v, nombre = `A${cod}`) => ({
  cod_asesor: cod, asesor_nombre: nombre, dia, tipo_cliente: tipo, canal_key: canal, c, v
})
const SEP = planWeeksOfMonth('2026-09-01') // S36 1-6 ... S40 28-30

describe('aggregateVentasCanal', () => {
  const rows = [
    fila(1, '2026-09-01', 'NEW', 'fb', 10, 2, 'Zoe'),
    fila(1, '2026-09-06', 'NEW', 'bot', 3, 1, 'Zoe'),
    fila(2, '2026-09-02', 'NEW', 'fb', 5, 1, 'Ana'),
    fila(2, '2026-09-03', 'CWE', 'com', 2, 2, 'Ana'),
    fila(2, '2026-09-08', 'LDS', 'ig', 4, 0, 'Ana'),
    fila(2, '2026-09-09', 'LDS', 'raro', 9, 9, 'Ana')
  ]

  it('reparte por las semanas del Plan Comercial y suma tipo de cliente y canal', () => {
    const { weeks } = aggregateVentasCanal(rows, null, SEP)
    expect(weeks.map(w => [w.label, w.from, w.to])[0]).toEqual(['S36', '2026-09-01', '2026-09-06'])
    expect(weeks[0].rows.NEW.fb).toEqual({ c: 15, v: 3 })
    expect(weeks[0].rows.NEW.bot).toEqual({ c: 3, v: 1 })
    expect(weeks[0].rows.CWE.com).toEqual({ c: 2, v: 2 })
    expect(weeks[1].rows.LDS.ig).toEqual({ c: 4, v: 0 })
    expect(weeks[0].rows.MEMBERS.web).toEqual({ c: 0, v: 0 })
  })

  it('devuelve todas las semanas del mes, aun sin datos (la ultima termina el 30)', () => {
    const { weeks } = aggregateVentasCanal([], null, SEP)
    expect(weeks).toHaveLength(5)
    expect(weeks.at(-1)).toMatchObject({ week: 5, label: 'S40', from: '2026-09-28', to: '2026-09-30' })
  })

  it('ignora canales que no conoce en vez de inventar columnas', () => {
    expect(aggregateVentasCanal(rows, null, SEP).weeks[1].rows.LDS.raro).toBeUndefined()
  })

  it('filtra por asesor pero la lista de asesores sigue completa y ordenada', () => {
    const r = aggregateVentasCanal(rows, 1, SEP)
    expect(r.weeks[0].rows.NEW.fb).toEqual({ c: 10, v: 2 })
    expect(r.weeks[1].rows.LDS.ig).toEqual({ c: 0, v: 0 })
    expect(r.advisors).toEqual([{ id: 2, name: 'Ana' }, { id: 1, name: 'Zoe' }])
  })

  it('mes sin datos ni calendario', () => {
    expect(aggregateVentasCanal([])).toEqual({ advisors: [], weeks: [] })
  })
})
