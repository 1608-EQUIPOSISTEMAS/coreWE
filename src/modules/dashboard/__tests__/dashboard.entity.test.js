import { describe, it, expect } from 'vitest'
import {
  parseJsonbField,
  mapDashboardRow,
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

describe('teamScopeFor', () => {
  it('ADMIN ve la empresa entera: sin filtro de area ni de persona', () => {
    expect(teamScopeFor({ roles: ['ADMIN'], userId: 7 }))
      .toEqual({ areaRoles: null, userId: null, area: 'Todas las áreas', isLeader: true, leaderKey: null })
  })

  it('un lider ve su area, no a si mismo', () => {
    const scope = teamScopeFor({ roles: ['LIDER_FICO'], userId: 7 })
    expect(scope.areaRoles).toEqual(['FICO', 'LIDER_FICO'])
    expect(scope.userId).toBeNull()
    expect(scope.isLeader).toBe(true)
    expect(scope.leaderKey).toBe('LIDER_FICO')
  })

  it('un lider de dos areas las ve a las dos sin repetir roles, y los resultados de la primera', () => {
    const scope = teamScopeFor({ roles: ['LIDER_B2B', 'LIDER_COMERCIAL', 'COMERCIAL'], userId: 7 })
    expect([...scope.areaRoles].sort())
      .toEqual(['B2B', 'COMERCIAL', 'LIDER_B2B', 'LIDER_COMERCIAL'])
    expect(scope.leaderKey).toBe('LIDER_B2B')
  })

  it('un colaborador solo se ve a si mismo', () => {
    expect(teamScopeFor({ roles: ['COMERCIAL'], userId: 7 }))
      .toEqual({ areaRoles: null, userId: 7, area: 'Mi actividad', isLeader: false, leaderKey: null })
  })

  // A diferencia de la Auditoria, que lanza 403: aqui todos tienen panel.
  it('un rol sin area no revienta, cae a su propio panel', () => {
    expect(teamScopeFor({ roles: ['MARKETING'], userId: 9 }).userId).toBe(9)
    expect(teamScopeFor({ userId: 9 }).isLeader).toBe(false)
  })

  it('ADMIN con view_as ve exactamente el panel de ese lider', () => {
    expect(teamScopeFor({ roles: ['ADMIN'], userId: 7, viewAs: 'LIDER_FICO' }))
      .toEqual({ areaRoles: ['FICO', 'LIDER_FICO'], userId: null, area: 'FICO', isLeader: true, leaderKey: 'LIDER_FICO' })
  })

  it('view_as no amplia el alcance de quien no es ADMIN', () => {
    const scope = teamScopeFor({ roles: ['LIDER_COMERCIAL'], userId: 7, viewAs: 'LIDER_FICO' })
    expect(scope.area).toBe('Comercial')
    expect(scope.areaRoles).toEqual(['COMERCIAL', 'LIDER_COMERCIAL'])
  })

  it('un view_as desconocido (incluso del prototipo) deja al ADMIN viendo todo', () => {
    expect(teamScopeFor({ roles: ['ADMIN'], viewAs: 'toString' }).areaRoles).toBeNull()
  })
})

