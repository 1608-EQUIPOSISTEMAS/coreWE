import { describe, it, expect } from 'vitest'
import {
  parseJsonbField,
  formatWeekLabel,
  mapDashboardRow,
  mapLiderRow,
  mapContactabilityRow,
  aggregateVentasCanal,
  MONTHS_ES,
  teamScopeFor
} from '../dashboard.entity.js'

describe('parseJsonbField', () => {
  it('parsea string JSON a objeto', () => {
    expect(parseJsonbField('[{"a":1}]')).toEqual([{ a: 1 }])
  })
  it('devuelve el valor tal cual si ya esta hidratado', () => {
    const v = [{ a: 1 }]
    expect(parseJsonbField(v)).toBe(v)
  })
  it('cae a arreglo vacio ante null o undefined', () => {
    expect(parseJsonbField(null)).toEqual([])
    expect(parseJsonbField(undefined)).toEqual([])
  })
})

describe('formatWeekLabel', () => {
  it('rango dentro del mismo mes: DD al DD Mmm', () => {
    const out = formatWeekLabel(
      { period_label: 'S1', month_period: 'ENE', date_start: '2026-03-16', date_end: '2026-03-22' },
      0
    )
    expect(out.label).toBe('SEM 1 · 16 al 22 Mar')
    expect(out.value).toBe('S1')
    expect(out.month).toBe('ENE')
    expect(out.date_start).toBe('2026-03-16')
    expect(out.date_end).toBe('2026-03-22')
  })

  it('rango entre meses: DD Mmm al DD Mmm', () => {
    const out = formatWeekLabel(
      { period_label: 'S5', month_period: 'ENE', date_start: '2026-01-30', date_end: '2026-02-05' },
      4
    )
    expect(out.label).toBe('SEM 5 · 30 Ene al 5 Feb')
  })

  it('usa MONTHS_ES para la abreviatura', () => {
    expect(MONTHS_ES['12']).toBe('Dic')
  })
})

describe('mapDashboardRow', () => {
  it('convierte numericos y parsea JSONB', () => {
    const out = mapDashboardRow({
      target_id: 1,
      asesor: 'X',
      objetivo: '10',
      logrado: null,
      chart_objeciones: '[{"k":1}]',
      desglose_diario: undefined
    })
    expect(out.objetivo).toBe(10)
    expect(out.logrado).toBe(0)
    expect(out.chart_objeciones).toEqual([{ k: 1 }])
    expect(out.desglose_diario).toEqual([])
  })
})

describe('mapLiderRow', () => {
  it('normaliza totales y json', () => {
    const out = mapLiderRow({
      cod_asesor: 'A1',
      total_leads: '5',
      json_pending_tasks: '[1,2]'
    })
    expect(out.total_leads).toBe(5)
    expect(out.json_pending_tasks).toEqual([1, 2])
  })
})

describe('mapContactabilityRow', () => {
  it('normaliza tasas y json', () => {
    const out = mapContactabilityRow({
      cod_asesor: 'A1',
      tasa_conversion: '0.5',
      chart_tendencia_horaria: null
    })
    expect(out.tasa_conversion).toBe(0.5)
    expect(out.chart_tendencia_horaria).toEqual([])
  })
})

describe('aggregateVentasCanal', () => {
  it('agrega canales de multiples asesores en la misma semana sumando con +=', () => {
    const rows = [
      {
        semana_mes: 1,
        semana_label: 'Semana 1',
        fecha_desde: '2026-01-01',
        fecha_hasta: '2026-01-07',
        rows_data: [{ type: 'NEW', channels: { fb: { c: 1, v: 100 } } }]
      },
      {
        semana_mes: 1,
        semana_label: 'Semana 1',
        fecha_desde: '2026-01-01',
        fecha_hasta: '2026-01-07',
        rows_data: [{ type: 'NEW', channels: { fb: { c: 2, v: 50 } } }]
      }
    ]
    const out = aggregateVentasCanal(rows)
    expect(out.total).toBe(1)
    const newRow = out.weeklyData[0].rows.find(r => r.type === 'NEW')
    expect(newRow.channels.fb).toEqual({ c: 3, v: 150 })
  })

  it('inicializa los cuatro tipos con la estructura de canales por defecto', () => {
    const out = aggregateVentasCanal([
      { semana_mes: 2, semana_label: 'Semana 2', rows_data: [] }
    ])
    const types = out.weeklyData[0].rows.map(r => r.type)
    expect(types).toEqual(['NEW', 'LDS', 'CWE', 'MEMBERS'])
    expect(out.weeklyData[0].rows[0].channels.lk).toEqual({ c: 0, v: 0 })
  })

  it('no comparte referencias entre tipos (clon profundo)', () => {
    const out = aggregateVentasCanal([
      { semana_mes: 3, semana_label: 'S3', rows_data: [{ type: 'NEW', channels: { ig: { c: 9, v: 9 } } }] }
    ])
    const rowsByType = Object.fromEntries(out.weeklyData[0].rows.map(r => [r.type, r]))
    expect(rowsByType.NEW.channels.ig).toEqual({ c: 9, v: 9 })
    expect(rowsByType.LDS.channels.ig).toEqual({ c: 0, v: 0 })
  })

  it('ignora canales desconocidos no presentes en los defaults', () => {
    const out = aggregateVentasCanal([
      { semana_mes: 4, semana_label: 'S4', rows_data: [{ type: 'NEW', channels: { zzz: { c: 5, v: 5 } } }] }
    ])
    const newRow = out.weeklyData[0].rows.find(r => r.type === 'NEW')
    expect(newRow.channels.zzz).toBeUndefined()
  })
})

describe('teamScopeFor', () => {
  it('ADMIN ve la empresa entera: sin filtro de area ni de persona', () => {
    expect(teamScopeFor({ roles: ['ADMIN'], userId: 7 }))
      .toEqual({ areaRoles: null, userId: null, area: 'Todas las áreas', isLeader: true })
  })

  it('un lider ve su area, no a si mismo', () => {
    const scope = teamScopeFor({ roles: ['LIDER_FICO'], userId: 7 })
    expect(scope.areaRoles).toEqual(['FICO', 'LIDER_FICO'])
    expect(scope.userId).toBeNull()
    expect(scope.isLeader).toBe(true)
  })

  it('un lider de dos areas las ve a las dos sin repetir roles', () => {
    const scope = teamScopeFor({ roles: ['LIDER_B2B', 'LIDER_COMERCIAL', 'COMERCIAL'], userId: 7 })
    expect([...scope.areaRoles].sort())
      .toEqual(['B2B', 'COMERCIAL', 'LIDER_B2B', 'LIDER_COMERCIAL'])
  })

  it('un colaborador solo se ve a si mismo', () => {
    expect(teamScopeFor({ roles: ['COMERCIAL'], userId: 7 }))
      .toEqual({ areaRoles: null, userId: 7, area: 'Mi actividad', isLeader: false })
  })

  // A diferencia de la Auditoria, que lanza 403: aqui todos tienen panel.
  it('un rol sin area no revienta, cae a su propio panel', () => {
    expect(teamScopeFor({ roles: ['MARKETING'], userId: 9 }).userId).toBe(9)
    expect(teamScopeFor({ userId: 9 }).isLeader).toBe(false)
  })
})
