import { describe, it, expect } from 'vitest'
import {
  isoWeekNumber,
  planWeeksOfMonth,
  fullWeeksTouchingMonth,
  sumInRange,
  buildMonthPlan,
  nextMonthStart,
  daysOf,
  repurchaseOfMonths,
  productsOfMonth,
  buildProductGoals,
  annualReport,
  strategyReport
} from '../plancomercial.entity.js'

describe('isoWeekNumber', () => {
  it('el 31/08/2026 (lunes) es la S36, igual que el Sheet', () => {
    expect(isoWeekNumber('2026-08-31')).toBe(36)
    expect(isoWeekNumber('2026-09-06')).toBe(36)
  })
  it('el 1/1/2026 (jueves) ya es semana 1', () => {
    expect(isoWeekNumber('2026-01-01')).toBe(1)
  })
  it('el 1/1/2027 (viernes) todavia es la ultima semana de 2026', () => {
    expect(isoWeekNumber('2027-01-01')).toBe(53)
  })
})

describe('planWeeksOfMonth', () => {
  it('recorta la semana que cruza el mes: septiembre 2026 = S36..S40 del Sheet', () => {
    expect(planWeeksOfMonth('2026-09-01')).toEqual([
      { week_label: 'S36', date_start: '2026-09-01', date_end: '2026-09-06' },
      { week_label: 'S37', date_start: '2026-09-07', date_end: '2026-09-13' },
      { week_label: 'S38', date_start: '2026-09-14', date_end: '2026-09-20' },
      { week_label: 'S39', date_start: '2026-09-21', date_end: '2026-09-27' },
      { week_label: 'S40', date_start: '2026-09-28', date_end: '2026-09-30' }
    ])
  })
  it('agosto 2026 abre con la S31 de dos dias y cierra con la S36 de un dia', () => {
    const weeks = planWeeksOfMonth('2026-08-01')
    expect(weeks[0]).toEqual({ week_label: 'S31', date_start: '2026-08-01', date_end: '2026-08-02' })
    expect(weeks.at(-1)).toEqual({ week_label: 'S36', date_start: '2026-08-31', date_end: '2026-08-31' })
    expect(weeks).toHaveLength(6)
  })
  it('las semanas cubren el mes entero sin huecos ni solapes', () => {
    const days = planWeeksOfMonth('2026-02-01').flatMap(daysOf)
    expect(days).toHaveLength(28)
    expect(new Set(days).size).toBe(28)
  })
})

describe('fullWeeksTouchingMonth', () => {
  it('septiembre 2026 se lee en cinco semanas completas de lunes a domingo', () => {
    const weeks = fullWeeksTouchingMonth('2026-09-01')
    expect(weeks.map((w) => w.week_label)).toEqual(['S36', 'S37', 'S38', 'S39', 'S40'])
    expect(weeks[0]).toMatchObject({ date_start: '2026-08-31', date_end: '2026-09-06' })
    expect(weeks.at(-1)).toMatchObject({ date_start: '2026-09-28', date_end: '2026-10-04' })
  })
})

describe('nextMonthStart', () => {
  it('diciembre pasa al enero del ano siguiente', () => {
    expect(nextMonthStart('2026-12-01')).toBe('2027-01-01')
  })
})

describe('sumInRange', () => {
  const rows = [
    { dia: '2026-09-01', n: 2, usd: false },
    { dia: '2026-09-06', n: 3, usd: true },
    { dia: '2026-09-07', n: 5, usd: false }
  ]
  it('incluye los dos extremos del rango', () => {
    expect(sumInRange(rows, { date_start: '2026-09-01', date_end: '2026-09-06' })).toBe(5)
  })
  it('aplica el filtro', () => {
    expect(sumInRange(rows, { date_start: '2026-09-01', date_end: '2026-09-30' }, 'n', (r) => !r.usd)).toBe(7)
  })
})

describe('buildMonthPlan', () => {
  it('toma fechas del calendario, no del payload, y deja vacio lo que no se cargo', () => {
    const { weeks, unknown } = buildMonthPlan('2026-09-01', [
      { date_start: '2026-09-07', date_end: '2026-12-31', obj_vacantes: 95, obj_ingresos: '35111', asesores: { 3: 19, 2: '', 5: 0 } }
    ])
    expect(unknown).toEqual([])
    expect(weeks).toHaveLength(5)
    expect(weeks[1]).toMatchObject({
      date_start: '2026-09-07',
      date_end: '2026-09-13',
      target_vacancies: 95,
      target_revenue: 35111,
      asesores: [{ seller_agent_id: 3, target_vacancies: 19 }, { seller_agent_id: 5, target_vacancies: 0 }]
    })
    expect(weeks[0].target_vacancies).toBeNull()
  })
  it('reporta las semanas que no son del mes', () => {
    expect(buildMonthPlan('2026-09-01', [{ date_start: '2026-08-31' }]).unknown).toEqual(['2026-08-31'])
  })
  it('rechaza un objetivo negativo', () => {
    expect(() => buildMonthPlan('2026-09-01', [{ date_start: '2026-09-01', obj_vacantes: -1 }])).toThrow(RangeError)
  })
})

describe('repurchaseOfMonths', () => {
  const rows = [
    { dia: '2026-08-31', ventas: 4, cwe: 1 },
    { dia: '2026-09-01', ventas: 10, cwe: 3 },
    { dia: '2026-09-06', ventas: 5, cwe: 2 },
    { dia: '2026-09-30', ventas: 2, cwe: 0 }
  ]

  it('suma el mes y reparte en las semanas recortadas al mes', () => {
    const [sep] = repurchaseOfMonths(rows, ['2026-09-01'])
    expect(sep).toMatchObject({ month_start: '2026-09-01', ventas: 17, cwe: 5 })
    expect(sep.weeks[0]).toMatchObject({ week_label: 'S36', ventas: 15, cwe: 5 })
    expect(sep.weeks.at(-1)).toMatchObject({ week_label: 'S40', ventas: 2, cwe: 0 })
  })

  it('la S36 de agosto (solo el 31) no se lleva las ventas de septiembre', () => {
    const [ago] = repurchaseOfMonths(rows, ['2026-08-01'])
    expect(ago.weeks.at(-1)).toMatchObject({ week_label: 'S36', ventas: 4, cwe: 1 })
  })
})

describe('productsOfMonth', () => {
  const sales = [
    { product: 'PLUS', canal: 'COM', tipo: 'CWE', n: 3 },
    { product: 'PLUS', canal: 'WEB', tipo: null, n: 2 },
    { product: 'BLACK', canal: 'MKT', tipo: 'NEW', n: 1 }
  ]

  it('suma por producto, canal y tipo; sin lead va a SIN_DATO y no a NEW', () => {
    const [plus] = productsOfMonth(sales, [{ product: 'PLUS', target_vacancies: 10 }])
    expect(plus).toMatchObject({ product: 'PLUS', obj: 10, ventas: 5 })
    expect(plus.canal).toEqual({ MKT: 0, COM: 3, WEB: 2, OTROS: 0 })
    expect(plus.tipo).toEqual({ NEW: 0, LDS: 0, CWE: 3, SIN_DATO: 2 })
  })

  it('devuelve los 5 productos; sin objetivo cargado es null, no 0', () => {
    const rows = productsOfMonth(sales, [])
    expect(rows.map((r) => r.product)).toEqual(['PLUS', 'CURSOS', 'ESPECIALIZACIONES', 'GOLD_PLAT', 'BLACK'])
    expect(rows.find((r) => r.product === 'CURSOS')).toMatchObject({ obj: null, ventas: 0 })
  })
})

describe('buildProductGoals', () => {
  it('guarda solo los objetivos cargados y rechaza productos inventados', () => {
    expect(buildProductGoals({ PLUS: '12', CURSOS: '', BLACK: 0 })).toEqual([
      { product: 'PLUS', target_vacancies: 12 },
      { product: 'BLACK', target_vacancies: 0 }
    ])
    expect(() => buildProductGoals({ GOLD: 3 })).toThrow(RangeError)
    expect(() => buildProductGoals({ PLUS: -1 })).toThrow(RangeError)
  })
})

describe('annualReport', () => {
  const rows = [
    { mes: '2025-10', seller_id: 5, alias: 'AE30', name: 'GRECIA', n: 7 },
    { mes: '2026-01', seller_id: 5, alias: 'AE30', name: 'GRECIA', n: 3 },
    { mes: '2026-01', seller_id: 37, alias: 'WEB', name: null, n: 1 },
    { mes: '2026-02', seller_id: null, alias: null, name: null, n: 4 },
    { mes: '2026-02', seller_id: 5, alias: 'AE30', name: 'GRECIA', n: 2 }
  ]

  it('arma una curva de 12 meses por cada año con datos', () => {
    const r = annualReport(rows, 2026)
    expect(r.curva.map((c) => [c.year, c.total])).toEqual([[2025, 7], [2026, 10]])
    expect(r.curva[0].meses[9]).toBe(7)
  })

  it('solo el año pedido en asesores; sin asesor suma al total y la participacion cierra en 100%', () => {
    const r = annualReport(rows, 2026)
    expect(r.asesores.map((a) => [a.nombre, a.total])).toEqual([['GRECIA', 5], ['Sin asesor', 4], ['WEB', 1]])
    expect(r.asesores[0].participacion).toBe(0.5)
    expect(r.asesores.reduce((s, a) => s + a.participacion, 0)).toBeCloseTo(1)
    expect(r.total.slice(0, 3)).toEqual([4, 6, 0])
  })

  it('año sin ventas: participacion null, no division entre cero', () => {
    expect(annualReport(rows, 2024)).toMatchObject({ asesores: [], total: Array(12).fill(0) })
  })
})

describe('strategyReport', () => {
  it('agrupa por estrategia, ordena por consultas y la conversion es ventas / consultas', () => {
    const r = strategyReport([
      { estrategia: 'Mailing', programa: 'EXCEL', consultas: 4, ventas: 1 },
      { estrategia: 'Grupo de estudio', programa: 'SAP MM', consultas: 10, ventas: 2 },
      { estrategia: 'Grupo de estudio', programa: 'POWER BI', consultas: 20, ventas: 1 },
      { estrategia: 'Partners', programa: 'EXCEL', consultas: 0, ventas: 3 }
    ])
    expect(r.estrategias.map((e) => e.estrategia)).toEqual(['Grupo de estudio', 'Mailing', 'Partners'])
    expect(r.estrategias[0]).toMatchObject({ consultas: 30, ventas: 3, conversion: 0.1 })
    expect(r.estrategias[0].programas[0].programa).toBe('POWER BI')
    expect(r.estrategias[2].conversion).toBeNull()
    expect(r.total).toEqual({ consultas: 34, ventas: 7, conversion: 7 / 34 })
  })
})
