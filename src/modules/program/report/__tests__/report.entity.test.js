import { describe, it, expect } from 'vitest'
import { goalForPeriod, buildProductReport, countOperation } from '../report.entity.js'

describe('goalForPeriod', () => {
  it('prorratea la meta mensual sin redondear a cero una semana', () => {
    expect(goalForPeriod(2, { start: '2026-09-01', end: '2026-09-30' })).toBe(2)
    expect(goalForPeriod(2, { start: '2026-07-01', end: '2026-09-30' })).toBe(6) // trimestre
    expect(goalForPeriod(1, { start: '2026-09-01', end: '2026-09-07' })).toBe(0.2)
  })
})

describe('buildProductReport', () => {
  it('cuenta solo los cursos del rango y arma 6 meses por objetivo de la linea', () => {
    const r = buildProductReport({
      linea: 'online',
      period: { start: '2026-08-01', end: '2026-08-31' },
      today: '2026-09-29',
      cursos: {
        fichas: [{ programa: 'A', dia: '2026-08-10' }, { programa: 'B', dia: '2026-07-02' }],
        lanzados: [],
        mejorados: [{ programa: 'C', version: 'V2', dia: '2026-08-20' }]
      }
    })
    expect(r.objetivos.map((o) => [o.clave, o.logrado, o.meta, o.tono])).toEqual([
      ['fichas', 1, 2, 'bad'],
      ['mejorados', 1, 1, 'ok']
    ])
    expect(r.objetivos[0].cursos).toEqual([{ programa: 'A', dia: '2026-08-10' }])
    expect(r.meses.at(-2)).toMatchObject({ mes: '2026-07', fichas: { logrado: 1 } })
  })
})

describe('countOperation', () => {
  it('cuenta por clave y saca el % de ediciones que llegaron a su meta', () => {
    const r = countOperation([
      { clave: 'programados' }, { clave: 'programados' }, { clave: 'a5' },
      { clave: 'meta_ok' }, { clave: 'meta_no' }, { clave: 'meta_no' }, { clave: 'meta_ok' }
    ])
    expect(r).toMatchObject({ programados: 2, a5: 1, seguimientos: 0, meta_ok: 2, meta_no: 2, pct_meta_ok: 50 })
  })

  it('la linea sin cronograma no trae operacion', () => {
    const r = buildProductReport({ linea: 'online', period: { start: '2026-08-01', end: '2026-08-31' }, today: '2026-09-29', cursos: { fichas: [], lanzados: [], mejorados: [] } })
    expect(r.operacion).toBeNull()
    expect(r.meses[0].operacion).toBeNull()
  })
})
