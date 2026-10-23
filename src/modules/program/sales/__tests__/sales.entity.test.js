import { describe, it, expect } from 'vitest'
import { buildProductSales } from '../sales.entity.js'

const row = (linea, tipo, programId, n, soles) => ({ linea, tipo, program_id: programId, programa: `P${programId}`, n, soles })
const section = (view, key) => view.secciones.find(s => s.key === key)

describe('buildProductSales', () => {
  const rows = [
    row('ENVIVO', 'Diplomado', 1, 3, 3000),
    row('ENVIVO', 'Curso', 2, 5, 1000),
    row('ENVIVO', 'Curso', 2, 1, 200), // otro dia del mismo programa
    row('ENVIVO', 'PEE', 3, 3, 4500),
    row('ONLINE', 'Curso', 4, 2, 100),
    row('ONLINE', 'Membresía', 5, 4, 1600),
    row('B2B', 'Diplomado', 1, 9, 9000),
    row('FUNDACION', 'Congreso / Evento', 6, 7, 700)
  ]
  const prevRows = [row('ENVIVO', 'Diplomado', 1, 6, 6000), row('ENVIVO', 'Curso', 2, 2, 400)]
  const view = buildProductSales({ period: {}, rows, prevRows })

  it('ordena por ventas y desempata por soles, sumando los dias del mismo programa', () => {
    expect(section(view, 'ENVIVO').programas.map(p => [p.program_id, p.n, p.puesto])).toEqual([[2, 6, 1], [3, 3, 2], [1, 3, 3]])
  })

  it('separa las membresias de Online y deja fuera B2B y Fundacion', () => {
    expect(section(view, 'ONLINE').programas.map(p => p.program_id)).toEqual([4])
    expect(section(view, 'MEMBRESIA').programas.map(p => p.program_id)).toEqual([5])
    expect(section(view, 'ENVIVO').n).toBe(12)
  })

  it('compara contra el puesto y las ventas del periodo anterior', () => {
    const [curso, , diplomado] = section(view, 'ENVIVO').programas
    expect(curso).toMatchObject({ puesto_prev: 2, n_prev: 2 })
    expect(diplomado).toMatchObject({ puesto_prev: 1, n_prev: 6 })
    expect(section(view, 'ENVIVO')).toMatchObject({ n_prev: 8, n_trend: 50, n_tone: 'ok' })
    expect(section(view, 'ONLINE')).toMatchObject({ n_prev: 0, n_trend: null, n_tone: null })
  })

  it('arma la serie por seccion solo hasta el ultimo dia del periodo en curso', () => {
    const period = { bucket: 'dia', from: '2026-10-01', to: '2026-10-03' }
    const dated = [{ ...row('ENVIVO', 'Curso', 2, 2, 400), dia: '2026-10-01' }, { ...row('ONLINE', 'Membresía', 5, 1, 400), dia: '2026-10-03' }]
    const { serie } = buildProductSales({ period, rows: dated, prevRows: [] })
    expect(serie.categorias).toEqual(['1', '2', '3'])
    expect(serie.secciones.map(s => [s.key, s.datos])).toEqual([['ENVIVO', [2, 0, 0]], ['ONLINE', [0, 0, 0]], ['MEMBRESIA', [0, 0, 1]]])
  })

  it('el trimestre va por semana desde el lunes, rotulando la primera con el inicio del periodo', () => {
    // 2026-07-01 es miercoles: su semana arranca el lunes 29/06.
    const period = { bucket: 'semana', from: '2026-07-01', to: '2026-07-15' }
    const dated = [
      { ...row('ENVIVO', 'Curso', 2, 2, 400), dia: '2026-07-03' },
      { ...row('ENVIVO', 'Curso', 2, 1, 200), dia: '2026-07-06' },
      { ...row('ENVIVO', 'Curso', 2, 4, 800), dia: '2026-07-15' }
    ]
    const { serie } = buildProductSales({ period, rows: dated, prevRows: [] })
    expect(serie.categorias).toEqual(['01/07', '06/07', '13/07'])
    expect(serie.secciones[0].datos).toEqual([2, 1, 4])
  })

  it('en un año en curso la serie llega hasta el mes actual', () => {
    const { serie } = buildProductSales({ period: { bucket: 'mes', from: '2026-01-01', to: '2026-03-10' }, rows: [], prevRows: [] })
    expect(serie.categorias).toEqual(['ene', 'feb', 'mar'])
  })

  it('marca como caida al que vendia 3 o mas y ahora vende la mitad o menos, incluso cero', () => {
    const prev = [row('ENVIVO', 'Curso', 1, 10, 1000), row('ENVIVO', 'Curso', 2, 4, 400), row('ENVIVO', 'PEE', 3, 6, 600), row('ENVIVO', 'Curso', 4, 2, 200)]
    const now = [row('ENVIVO', 'Curso', 1, 5, 500), row('ENVIVO', 'Curso', 2, 3, 300), row('ENVIVO', 'Curso', 4, 0, 0)]
    const { caidas } = section(buildProductSales({ period: {}, rows: now, prevRows: prev }), 'ENVIVO')
    // 3: de 6 a 0 (pierde 6) va antes que 1: de 10 a 5 (pierde 5). 2 baja 25%; 4 venia de 2 (ruido).
    expect(caidas.map(c => [c.program_id, c.n_prev, c.n, c.variacion])).toEqual([[3, 6, 0, -100], [1, 10, 5, -50]])
  })

  it('resume por tipo con su parte de las ventas de la linea', () => {
    expect(section(view, 'ENVIVO').tipos).toEqual([
      { tipo: 'Curso', n: 6, soles: 1200, pct: 50 },
      { tipo: 'PEE', n: 3, soles: 4500, pct: 25 },
      { tipo: 'Diplomado', n: 3, soles: 3000, pct: 25 }
    ])
  })
})
