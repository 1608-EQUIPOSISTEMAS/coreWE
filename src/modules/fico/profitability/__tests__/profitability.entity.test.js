import { describe, it, expect } from 'vitest'
import {
  periodRange, salesRange, profitRange, hoursPerSession, buildSalesView,
  allocateMarketing, allocateInstructorCost, buildProfitView, validateMarketingRows
} from '../profitability.entity.js'

const sale = (over) => ({ dia: '2026-09-10', linea: 'ENVIVO', tipo: 'Curso', program_id: 1, programa: 'Excel', n: 1, soles: 100, ...over })

describe('periodRange', () => {
  it('dia compara contra ayer, aun cruzando el mes', () => {
    expect(periodRange('dia', '2026-10-01')).toMatchObject({ from: '2026-10-01', to: '2026-10-01', prev: { from: '2026-09-30', to: '2026-09-30' } })
  })
  it('mes compara contra el mes anterior, enero contra diciembre', () => {
    expect(periodRange('mes', '2026-01-15')).toMatchObject({ from: '2026-01-01', to: '2026-01-31', prev: { from: '2025-12-01', to: '2025-12-31' } })
  })
  it('anio compara contra el año anterior', () => {
    expect(periodRange('anio', '2026-05-05')).toMatchObject({ from: '2026-01-01', to: '2026-12-31', prev: { from: '2025-01-01' } })
  })
  it('la rentabilidad de un dia es la de su mes', () => {
    expect(profitRange('dia', '2026-02-10')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' })
  })
  it('rechaza un periodo desconocido', () => {
    expect(() => periodRange('semana', '2026-01-01')).toThrow()
  })
})

describe('periodRange trimestral', () => {
  it('toma el trimestre de la fecha y el anterior, cruzando el año', () => {
    expect(periodRange('trimestre', '2026-08-15')).toMatchObject({
      from: '2026-07-01', to: '2026-09-30', prev: { from: '2026-04-01', to: '2026-06-30' }, bucket: 'semana'
    })
    expect(periodRange('trimestre', '2026-02-10')).toMatchObject({
      from: '2026-01-01', to: '2026-03-31', prev: { from: '2025-10-01', to: '2025-12-31' }
    })
  })
})

describe('salesRange', () => {
  it('el mes en curso se compara contra los mismos dias del mes anterior', () => {
    expect(salesRange('mes', '2026-10-01', '2026-10-19')).toMatchObject({
      from: '2026-10-01', to: '2026-10-19', partial: true, prev: { from: '2026-09-01', to: '2026-09-19' }
    })
  })
  it('del 31 no se pasa al mes siguiente si el anterior es mas corto', () => {
    expect(salesRange('mes', '2026-03-01', '2026-03-31').prev.to).toBe('2026-02-28')
  })
  it('un periodo cerrado se compara completo', () => {
    expect(salesRange('mes', '2026-09-01', '2026-10-19')).toMatchObject({ to: '2026-09-30', partial: false, prev: { to: '2026-08-31' } })
  })
  it('el año en curso contra el mismo tramo del año pasado', () => {
    expect(salesRange('anio', '2026-01-01', '2026-10-19')).toMatchObject({ to: '2026-10-19', prev: { from: '2025-01-01', to: '2025-10-19' } })
  })
})

describe('hoursPerSession', () => {
  it('lee el horario del alias', () => {
    expect(hoursPerSession('we_hour_combination_19_22')).toBe(3)
    expect(hoursPerSession('we_hour_combination_09_13')).toBe(4)
    expect(hoursPerSession('we_hour_combination_1930_2200')).toBe(2.5)
  })
  it('sin horario no supone horas', () => {
    expect(hoursPerSession(null)).toBeNull()
    expect(hoursPerSession('we_hour_combination_x')).toBeNull()
  })
})

describe('buildSalesView', () => {
  it('arma Linea -> Tipo -> Programa y compara contra el periodo anterior', () => {
    const view = buildSalesView({
      period: periodRange('mes', '2026-09-01'),
      measure: 'vendido',
      rows: [sale(), sale({ program_id: 2, programa: 'Power BI', soles: 300 }), sale({ linea: 'ONLINE', soles: 100 })],
      prevRows: [sale({ dia: '2026-08-10', soles: 250 })]
    })
    expect(view.kpis).toMatchObject({ soles: 500, n: 3, soles_prev: 250, soles_trend: 100, soles_tone: 'ok' })
    expect(view.lineas.map(l => l.key)).toEqual(['ENVIVO', 'ONLINE'])
    const envivo = view.lineas[0]
    expect(envivo).toMatchObject({ soles: 400, pct: 80, prev: 250, trend: 60 })
    expect(envivo.tipos[0].programas.map(p => p.label)).toEqual(['Power BI', 'Excel'])
    expect(view.serie.series[0].datos).toHaveLength(30) // dias de septiembre
  })
})

describe('allocateMarketing', () => {
  it('reparte el gasto de la unidad por la parte de ventas de cada programa', () => {
    const { allocated, unallocated } = allocateMarketing(
      [sale({ soles: 300 }), sale({ program_id: 2, soles: 100 })],
      [{ mes: '2026-09', linea: 'ENVIVO', amount: 1000 }, { mes: '2026-09', linea: 'ONLINE', amount: 50 }]
    )
    expect(allocated.get('ENVIVO|1')).toBe(750)
    expect(allocated.get('ENVIVO|2')).toBe(250)
    // Online gasto sin vender: no hay a quien cargarlo, se avisa.
    expect(unallocated).toBe(50)
  })
})

describe('allocateInstructorCost', () => {
  const ed = (over) => ({ edition_id: 9, instructor_id: 5, horario: 'we_hour_combination_19_22', sesiones: 4, tarifa: 50, linea: 'ENVIVO', program_id: 1, programa: 'Excel', tipo: 'Curso', reparto: [], ...over })

  it('sesiones x horas x tarifa, repartido por alumno entre los programas vendidos', () => {
    const { allocated, total } = allocateInstructorCost([ed({
      reparto: [
        { linea: 'ENVIVO', program_id: 1, programa: 'Excel', tipo: 'Curso', n: 1 },
        { linea: 'ENVIVO', program_id: 7, programa: 'Diplomado', tipo: 'Diplomado', n: 3 }
      ]
    })])
    expect(total).toBe(600) // 4 x 3 h x 50
    expect(allocated.get('ENVIVO|1')).toBe(150)
    expect(allocated.get('ENVIVO|7')).toBe(450)
  })
  it('sin alumnos lo carga el programa de la edicion', () => {
    expect(allocateInstructorCost([ed()]).allocated.get('ENVIVO|1')).toBe(600)
  })
  it('sin tarifa, horario o docente no inventa costo y lo cuenta', () => {
    const r = allocateInstructorCost([ed({ tarifa: null }), ed({ horario: null }), ed({ instructor_id: null })])
    expect(r.total).toBe(0)
    expect(r.missing).toEqual({ sin_tarifa: [9], sin_horario: [9], sin_docente: [9] })
  })
})

describe('buildProfitView', () => {
  it('margen = ingreso - docente - publicidad, con tono contra su unidad', () => {
    const view = buildProfitView({
      period: profitRange('mes', '2026-09-01'),
      sales: [sale({ soles: 1000 }), sale({ program_id: 2, programa: 'Power BI', soles: 1000 })],
      editions: [{ edition_id: 1, instructor_id: 5, horario: 'we_hour_combination_19_22', sesiones: 10, tarifa: 50, linea: 'ENVIVO', program_id: 2, programa: 'Power BI', tipo: 'Curso', reparto: [] }],
      spend: [{ mes: '2026-09', linea: 'ENVIVO', amount: 200 }]
    })
    expect(view.kpis).toMatchObject({ ingreso: 2000, docente: 1500, publicidad: 200, margen: 300, margen_pct: 15, en_perdida: 1 })
    const [excel, powerbi] = [...view.lineas[0].tipos[0].programas].sort((a, b) => a.program_id - b.program_id)
    expect(excel).toMatchObject({ margen: 900, tone: 'ok' })
    expect(powerbi).toMatchObject({ margen: -600, tone: 'bad' })
  })
})

describe('margen con costos sin cargar', () => {
  it('no se pinta de verde: sin publicidad el margen esta inflado', () => {
    const view = buildProfitView({ period: profitRange('mes', '2026-09-01'), sales: [sale()], editions: [], spend: [] })
    expect(view.kpis).toMatchObject({ margen: 100, margen_tone: null })
  })
})

describe('validateMarketingRows', () => {
  it('normaliza el mes y rechaza montos negativos o unidades desconocidas', () => {
    expect(validateMarketingRows(2026, [{ month: 3, line: 'ONLINE', amount: '1200.5' }])).toEqual([{ month: '2026-03-01', line: 'ONLINE', amount: 1200.5 }])
    expect(() => validateMarketingRows(2026, [{ month: 3, line: 'ONLINE', amount: -1 }])).toThrow()
    expect(() => validateMarketingRows(2026, [{ month: 3, line: 'RETAIL', amount: 1 }])).toThrow()
  })
})
