import { describe, it, expect } from 'vitest'
import {
  isoWeekNumber,
  planWeeksOfMonth,
  fullWeeksTouchingMonth,
  sumInRange,
  buildMonthPlan,
  nextMonthStart,
  daysOf
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
