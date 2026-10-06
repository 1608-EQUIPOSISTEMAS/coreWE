import { describe, it, expect } from 'vitest'
import { aggregateVentasCanal } from '../dashboard.entity.js'

const fila = (cod, semana, rows_data, nombre = `A${cod}`) => ({
  cod_asesor: cod, asesor_nombre: nombre, semana_mes: semana, semana_label: `SEM ${semana}`,
  fecha_desde: '2026-07-01', fecha_hasta: '2026-07-07', rows_data
})

describe('aggregateVentasCanal', () => {
  const rows = [
    fila(1, 1, [{ type: 'NEW', channels: { fb: { c: 10, v: 2 }, bot: { c: 3, v: 1 } } }], 'Zoe'),
    fila(2, 1, [{ type: 'NEW', channels: { fb: { c: 5, v: 1 } } }, { type: 'CWE', channels: { com: { c: 2, v: 2 } } }], 'Ana'),
    fila(2, 2, [{ type: 'LDS', channels: { ig: { c: 4, v: 0 }, raro: { c: 9, v: 9 } } }], 'Ana')
  ]

  it('suma los asesores por semana, tipo de cliente y canal', () => {
    const { weeks } = aggregateVentasCanal(rows)
    expect(weeks.map(w => w.week)).toEqual([1, 2])
    expect(weeks[0].rows.NEW.fb).toEqual({ c: 15, v: 3 })
    expect(weeks[0].rows.CWE.com).toEqual({ c: 2, v: 2 })
    expect(weeks[0].rows.MEMBERS.web).toEqual({ c: 0, v: 0 })
  })

  it('ignora canales que no conoce en vez de inventar columnas', () => {
    expect(aggregateVentasCanal(rows).weeks[1].rows.LDS.raro).toBeUndefined()
  })

  it('filtra por asesor pero la lista de asesores sigue completa y ordenada', () => {
    const r = aggregateVentasCanal(rows, 1)
    expect(r.weeks).toHaveLength(1)
    expect(r.weeks[0].rows.NEW.fb).toEqual({ c: 10, v: 2 })
    expect(r.advisors).toEqual([{ id: 2, name: 'Ana' }, { id: 1, name: 'Zoe' }])
  })

  it('la semana 4 llega hasta el ultimo dia del mes (la vista decia 28)', () => {
    const r = aggregateVentasCanal([{ ...fila(1, 4, []), fecha_desde: '2026-07-22', fecha_hasta: '2026-07-28' },
      { ...fila(1, 3, []), fecha_desde: '2026-02-15', fecha_hasta: '2026-02-21' }])
    expect(r.weeks.map(w => [w.from, w.to])).toEqual([['2026-02-15', '2026-02-21'], ['2026-07-22', '2026-07-31']])
  })

  it('mes sin datos', () => {
    expect(aggregateVentasCanal([])).toEqual({ advisors: [], weeks: [] })
  })
})
