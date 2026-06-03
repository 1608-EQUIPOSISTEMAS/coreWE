import { describe, it, expect } from 'vitest'
import {
  normalizeActive,
  normalizeActiveForCaller,
  buildEditionFilters,
  buildEditionByWeekFilters,
  buildA5Payload,
  validateRubricParams,
  aiAuditorAllowedHosts,
  isValidAiAuditorHost,
  resolveAiAuditorUrl,
  formatStartDate
} from '../edition.entity.js'

describe('normalizeActive (listado)', () => {
  it('mapea booleanos a Y/N', () => {
    expect(normalizeActive(true)).toBe('Y')
    expect(normalizeActive(false)).toBe('N')
  })
  it('deja pasar strings tal cual y null en el resto', () => {
    expect(normalizeActive('Y')).toBe('Y')
    expect(normalizeActive('')).toBe('')
    expect(normalizeActive(null)).toBeNull()
    expect(normalizeActive(undefined)).toBeNull()
  })
})

describe('normalizeActiveForCaller', () => {
  it('por defecto filtra activos', () => {
    expect(normalizeActiveForCaller()).toBe('Y')
  })
  it('trata el string vacio como sin filtro', () => {
    expect(normalizeActiveForCaller('')).toBeNull()
  })
  it('mapea booleanos y respeta strings', () => {
    expect(normalizeActiveForCaller(true)).toBe('Y')
    expect(normalizeActiveForCaller(false)).toBe('N')
    expect(normalizeActiveForCaller('N')).toBe('N')
  })
})

describe('buildEditionFilters', () => {
  it('aplica defaults y multiselect a []', () => {
    const { filters, page, size } = buildEditionFilters({})
    expect(page).toBe(1)
    expect(size).toBe(25)
    expect(filters.instructores_seleccionados).toEqual([])
    expect(filters.category_ids).toEqual([])
    expect(filters.active).toBeNull()
  })
  it('mapea active booleano a Y/N', () => {
    expect(buildEditionFilters({ active: true }).filters.active).toBe('Y')
    expect(buildEditionFilters({ active: false }).filters.active).toBe('N')
  })
  it('preserva valores provistos', () => {
    const { filters } = buildEditionFilters({ q: 'abc', page: 3, size: 50, program_version_id: 7 })
    expect(filters.q).toBe('abc')
    expect(filters.page).toBe(3)
    expect(filters.size).toBe(50)
    expect(filters.program_version_id).toBe(7)
  })
})

describe('buildEditionByWeekFilters', () => {
  it('usa mes/anio actuales cuando no se proveen', () => {
    const fixed = new Date('2026-05-29T00:00:00Z')
    const { filters } = buildEditionByWeekFilters({}, fixed)
    expect(filters.selectedMonth).toBe(fixed.getMonth() + 1)
    expect(filters.selectedYear).toBe(fixed.getFullYear())
  })
  it('respeta mes/anio explicitos y normaliza active', () => {
    const { filters, page, size } = buildEditionByWeekFilters(
      { selectedMonth: 3, selectedYear: 2025, active: true, page: 2, size: 10, q: 'x' },
      new Date('2026-05-29T00:00:00Z')
    )
    expect(filters.selectedMonth).toBe(3)
    expect(filters.selectedYear).toBe(2025)
    expect(filters.active).toBe('Y')
    expect(filters.q).toBe('x')
    expect(page).toBe(2)
    expect(size).toBe(10)
  })
})

describe('buildA5Payload', () => {
  it('valida edition_num_id > 0 y al menos una migracion', () => {
    expect(buildA5Payload({ edition_num_id: 5, migrations: [{}] })).toEqual({ valid: true, editionId: 5 })
  })
  it('rechaza id invalido o migraciones vacias', () => {
    expect(buildA5Payload({ edition_num_id: 0, migrations: [{}] }).valid).toBe(false)
    expect(buildA5Payload({ edition_num_id: 5, migrations: [] }).valid).toBe(false)
    expect(buildA5Payload({}).valid).toBe(false)
  })
})

describe('validateRubricParams', () => {
  it('acepta enteros validos con sesion >= 1', () => {
    expect(validateRubricParams(10, 3)).toEqual({ valid: true, eid: 10, sn: 3 })
  })
  it('rechaza sesion < 1 o no finitos', () => {
    expect(validateRubricParams(10, 0).valid).toBe(false)
    expect(validateRubricParams('x', 2).valid).toBe(false)
    expect(validateRubricParams(10, 'y').valid).toBe(false)
  })
})

describe('aiAuditorAllowedHosts / isValidAiAuditorHost', () => {
  it('siempre permite loopback', () => {
    const hosts = aiAuditorAllowedHosts({})
    expect(hosts.has('127.0.0.1')).toBe(true)
    expect(hosts.has('localhost')).toBe(true)
    expect(hosts.has('::1')).toBe(true)
  })
  it('agrega hosts de la env', () => {
    const hosts = aiAuditorAllowedHosts({ AI_AUDITOR_ALLOWED_HOSTS: 'ai.local, 10.0.0.5' })
    expect(hosts.has('ai.local')).toBe(true)
    expect(hosts.has('10.0.0.5')).toBe(true)
  })
  it('valida el host de una url contra el set', () => {
    const hosts = aiAuditorAllowedHosts({})
    expect(isValidAiAuditorHost('http://127.0.0.1:8090', hosts)).toBe(true)
    expect(isValidAiAuditorHost('http://evil.example.com/x', hosts)).toBe(false)
    expect(isValidAiAuditorHost('no-es-url', hosts)).toBe(false)
  })
})

describe('resolveAiAuditorUrl', () => {
  it('usa el default loopback sin env', () => {
    expect(resolveAiAuditorUrl({})).toBe('http://127.0.0.1:8090')
  })
  it('acepta una url con host permitido', () => {
    expect(resolveAiAuditorUrl({ AI_AUDITOR_URL: 'http://localhost:9000' })).toBe('http://localhost:9000')
  })
  it('lanza si el host no esta permitido', () => {
    expect(() => resolveAiAuditorUrl({ AI_AUDITOR_URL: 'http://evil.example.com' }))
      .toThrow(/host no permitido/)
  })
  it('lanza si la url es invalida', () => {
    expect(() => resolveAiAuditorUrl({ AI_AUDITOR_URL: 'no-es-url' }))
      .toThrow(/invalida/)
  })
})

describe('formatStartDate', () => {
  it('convierte DD/MM/YYYY a YYYY-MM-DD con padding', () => {
    expect(formatStartDate('5/3/2026')).toBe('2026-03-05')
    expect(formatStartDate('15/12/2026')).toBe('2026-12-15')
  })
  it('devuelve el valor original si no tiene 3 partes', () => {
    expect(formatStartDate('2026-01-01')).toBe('2026-01-01')
  })
})
