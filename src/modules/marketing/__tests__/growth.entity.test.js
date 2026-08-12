import { describe, it, expect } from 'vitest'
import {
  isoWeekStart,
  limaDate,
  buildGrowthSeries,
  validateManualSnapshot
} from '../growth.entity.js'
import { DomainError } from '../../../shared/errors.js'

describe('isoWeekStart', () => {
  it('lleva cualquier día de la semana a su lunes', () => {
    // 2026-08-12 es miércoles; su semana ISO arranca el lunes 10.
    expect(isoWeekStart('2026-08-12')).toBe('2026-08-10')
    expect(isoWeekStart('2026-08-10')).toBe('2026-08-10')
    expect(isoWeekStart('2026-08-16')).toBe('2026-08-10') // domingo, aún la misma semana
  })

  it('cruza el cambio de año sin partir la semana', () => {
    // La semana del 2025-12-29 al 2026-01-04 es una sola, con lunes en diciembre.
    expect(isoWeekStart('2025-12-31')).toBe('2025-12-29')
    expect(isoWeekStart('2026-01-01')).toBe('2025-12-29')
    expect(isoWeekStart('2026-01-04')).toBe('2025-12-29')
    expect(isoWeekStart('2026-01-05')).toBe('2026-01-05')
  })

  it('rechaza fechas mal formadas o inexistentes', () => {
    // La hoja original tenía un SEM 0 fechado 31/12/1899 y un 30/12/2024 -> 5/12/2024.
    for (const bad of ['', null, undefined, '12/08/2026', '2026-13-01', '2026-02-30']) {
      expect(() => isoWeekStart(bad)).toThrow(DomainError)
    }
  })
})

describe('limaDate', () => {
  it('usa el calendario de Lima, no el UTC', () => {
    // Domingo 23:00 en Lima = lunes 04:00 UTC. Si se resolviera en UTC, este
    // snapshot caería en la semana siguiente.
    expect(limaDate(new Date('2026-08-17T04:00:00Z'))).toBe('2026-08-16')
    expect(isoWeekStart(limaDate(new Date('2026-08-17T04:00:00Z')))).toBe('2026-08-10')
  })

  it('rechaza lo que no sea una fecha válida', () => {
    expect(() => limaDate('2026-08-12')).toThrow(DomainError)
    expect(() => limaDate(new Date('nope'))).toThrow(DomainError)
  })
})

describe('buildGrowthSeries', () => {
  const snapshot = (accountId, weekStart, followers) =>
    ({ account_id: accountId, week_start: weekStart, followers })

  it('deriva el crecimiento de la diferencia entre semanas consecutivas', () => {
    const series = buildGrowthSeries([
      snapshot(1, '2026-08-03', 1000),
      snapshot(1, '2026-08-10', 1150)
    ])
    expect(series.map(r => r.growth)).toEqual([null, 150])
    expect(series.map(r => r.weeks_spanned)).toEqual([null, 1])
  })

  it('no inventa datos cuando faltan semanas: marca cuántas abarca el delta', () => {
    // Si el cron no corrió dos semanas, el crecimiento es real pero acumulado.
    const series = buildGrowthSeries([
      snapshot(1, '2026-08-03', 1000),
      snapshot(1, '2026-08-24', 1300)
    ])
    expect(series[1]).toMatchObject({ growth: 300, weeks_spanned: 3 })
  })

  it('no mezcla cuentas entre sí', () => {
    const series = buildGrowthSeries([
      snapshot(1, '2026-08-03', 1000),
      snapshot(2, '2026-08-03', 50),
      snapshot(1, '2026-08-10', 1150),
      snapshot(2, '2026-08-10', 55)
    ])
    const growthOf = id => series.filter(r => r.account_id === id).map(r => r.growth)
    expect(growthOf(1)).toEqual([null, 150])
    expect(growthOf(2)).toEqual([null, 5])
  })

  it('ordena por semana aunque las filas lleguen desordenadas', () => {
    const series = buildGrowthSeries([
      snapshot(1, '2026-08-10', 1150),
      snapshot(1, '2026-08-03', 1000)
    ])
    expect(series.map(r => r.week_start)).toEqual(['2026-08-03', '2026-08-10'])
  })

  it('admite crecimiento negativo: una purga de bots no es un error', () => {
    // El -569 de Instagram que aparece en la hoja original era exactamente esto.
    const series = buildGrowthSeries([
      snapshot(1, '2026-08-03', 36974),
      snapshot(1, '2026-08-10', 36405)
    ])
    expect(series[1].growth).toBe(-569)
  })

  it('devuelve lista vacía sin entrada', () => {
    expect(buildGrowthSeries()).toEqual([])
    expect(buildGrowthSeries([])).toEqual([])
  })
})

describe('validateManualSnapshot', () => {
  it('normaliza la fecha elegida al lunes de esa semana', () => {
    expect(validateManualSnapshot({ account_id: 7, week_start: '2026-08-13', followers: 12290 }))
      .toEqual({ accountId: 7, weekStart: '2026-08-10', followers: 12290 })
  })

  it('acepta strings numéricos, que es lo que manda un formulario', () => {
    expect(validateManualSnapshot({ account_id: '7', week_start: '2026-08-10', followers: '12290' }))
      .toEqual({ accountId: 7, weekStart: '2026-08-10', followers: 12290 })
  })

  it('rechaza seguidores no enteros o negativos', () => {
    for (const bad of [-1, 1.5, 'abc', null, undefined]) {
      expect(() => validateManualSnapshot({ account_id: 7, week_start: '2026-08-10', followers: bad }))
        .toThrow(DomainError)
    }
  })

  it('rechaza account_id inválido', () => {
    for (const bad of [0, -3, 'x', null]) {
      expect(() => validateManualSnapshot({ account_id: bad, week_start: '2026-08-10', followers: 10 }))
        .toThrow(DomainError)
    }
  })
})
