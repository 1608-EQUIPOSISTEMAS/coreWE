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
  formatStartDate,
  b2bAttendanceSummary,
  isoWeekRange,
  getAllowedDays,
  sessionNumbersForRange,
  buildWeeklySessionDays,
  buildSessionSchedule,
  buildControlRow
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

describe('isoWeekRange (Vista Semanal Academica)', () => {
  it('semana 14 de 2026 = 30/mar a 05/abr (dato real de sales_targets S14)', () => {
    expect(isoWeekRange(2026, 14)).toEqual({ date_start: '2026-03-30', date_end: '2026-04-05' })
  })
  it('semana 1 puede empezar en el anio anterior', () => {
    // El 1-ene-2026 es jueves: la semana ISO 1 arranca el lunes 29-dic-2025.
    expect(isoWeekRange(2026, 1)).toEqual({ date_start: '2025-12-29', date_end: '2026-01-04' })
  })
})

describe('getAllowedDays (weekly)', () => {
  const combos = [{ catalog_id: 3012, variable_2: '[1,3]' }]
  it('parsea variable_2 del catalogo', () => {
    expect(getAllowedDays(combos, 3012, '2026-05-11')).toEqual([1, 3])
  })
  it('sin combinacion cae al weekday de start_date', () => {
    // 2026-05-11 es lunes (1)
    expect(getAllowedDays(combos, 9999, '2026-05-11')).toEqual([1])
  })
  it('matchea la forma real de sp_catalog_list (id string / catalogo_id)', () => {
    const spCombos = [{ id: '3012', catalogo_id: 3012, variable_2: '[1,3]' }]
    expect(getAllowedDays(spCombos, 3012, '2026-07-08')).toEqual([1, 3])
  })
})

describe('sessionNumbersForRange', () => {
  const base = {
    startDateStr: '2026-05-11', // lunes
    allowedDays: [1, 3], // Lun-Mie
    holidaySet: new Set(),
    totalSessions: 8,
    rangeStart: '2026-05-18',
    rangeEnd: '2026-05-24'
  }
  it('numera sesiones consecutivas dentro de la semana pedida', () => {
    // Sesiones: 11/05=1, 13/05=2, 18/05=3, 20/05=4...
    const map = sessionNumbersForRange(base)
    expect(map.get('2026-05-18')).toBe(3)
    expect(map.get('2026-05-20')).toBe(4)
    expect(map.size).toBe(2)
  })
  it('un feriado corre la sesion al siguiente dia permitido', () => {
    const map = sessionNumbersForRange({ ...base, holidaySet: new Set(['2026-05-18']) })
    expect(map.has('2026-05-18')).toBe(false)
    expect(map.get('2026-05-20')).toBe(3)
  })
  it('no proyecta sesiones mas alla de totalSessions ni del end_date del aula', () => {
    const corto = sessionNumbersForRange({ ...base, totalSessions: 3 })
    expect(corto.get('2026-05-18')).toBe(3)
    expect(corto.has('2026-05-20')).toBe(false)
    const terminado = sessionNumbersForRange({ ...base, endDateStr: '2026-05-18' })
    expect(terminado.get('2026-05-18')).toBe(3)
    expect(terminado.has('2026-05-20')).toBe(false)
  })
})

describe('buildSessionSchedule (Control de ediciones)', () => {
  const base = {
    startDateStr: '2026-05-11', // lunes
    allowedDays: [1, 3], // Lun-Mie
    holidaySet: new Set(),
    totalSessions: 4
  }
  it('deriva S1..Sn sin overrides', () => {
    const s = buildSessionSchedule(base)
    expect(s.map((x) => x.date)).toEqual(['2026-05-11', '2026-05-13', '2026-05-18', '2026-05-20'])
    expect(s.every((x) => x.status === null)).toBe(true)
  })
  it('una R corre las sesiones siguientes desde la nueva fecha', () => {
    // Caso real (POWER APPS AVANZ, Dom): 31/5, 7/6, 14/6, 21/6, 28/6, 5/7 y
    // la S2 (7/6) se reprograma al 28/6 => 31/5, 28/6(R), 5/7, 12/7, 19/7, 26/7.
    const s = buildSessionSchedule({
      startDateStr: '2026-05-31',
      allowedDays: [0], // domingos
      holidaySet: new Set(),
      totalSessions: 6,
      overrides: new Map([[2, { status: 'R', new_date: '2026-06-28' }]])
    })
    expect(s.map((x) => x.date)).toEqual([
      '2026-05-31', '2026-06-28', '2026-07-05', '2026-07-12', '2026-07-19', '2026-07-26'
    ])
    // Solo la reprogramada lleva new_date (tachado); las demas solo corren.
    expect(s[1]).toMatchObject({
      session_number: 2, planned_date: '2026-06-07', new_date: '2026-06-28', status: 'R'
    })
    expect(s[2]).toMatchObject({ session_number: 3, date: '2026-07-05', new_date: null })
  })
  it('cambiar el inicio (R de la S1) corre todo el cronograma', () => {
    // Caso Slack (CONT. FINANCIERA, Mar-Jue): inicio no fue 16/7 sino 21/7 y
    // "las demas fechas solo corren": 21/7, 23/7, 28/7, 30/7...
    const s = buildSessionSchedule({
      startDateStr: '2026-07-16',
      allowedDays: [2, 4], // Mar-Jue
      holidaySet: new Set(),
      totalSessions: 4,
      overrides: new Map([[1, { status: 'R', new_date: '2026-07-21' }]])
    })
    expect(s.map((x) => x.date)).toEqual(['2026-07-21', '2026-07-23', '2026-07-28', '2026-07-30'])
  })
  it('un feriado corre la sesion planificada', () => {
    const s = buildSessionSchedule({ ...base, holidaySet: new Set(['2026-05-13']) })
    expect(s[1].date).toBe('2026-05-18')
  })
})

describe('buildControlRow (derivados de gestion)', () => {
  const row = {
    edition_num_id: 7,
    abbreviation: 'POWER BI',
    cat_day_combination_id: 3012,
    start_date: '2026-05-11',
    total_sessions: 3
  }
  const ctx = { dayCombos: [{ catalog_id: 3012, variable_2: '[1,3]' }] }
  it('sesion actual = primera no dictada (una R futura sigue pendiente)', () => {
    // Planificadas: 11/5, 13/5, 18/5. La S1 se dicta, la S2 (13/5) se
    // reprograma al 20/5 y la S3 corre al siguiente dia permitido (25/5).
    // La actual es la S2 (reprogramada aun no dictada).
    const out = buildControlRow(row, {
      ...ctx,
      controls: [
        { program_edition_id: 7, session_number: 1, status: 'A' },
        { program_edition_id: 7, session_number: 2, status: 'R', new_date: '2026-05-20' }
      ]
    })
    expect(out.sessions.map((s) => s.date)).toEqual(['2026-05-11', '2026-05-20', '2026-05-25'])
    expect(out.current_label).toBe('S2')
    expect(out.repro_count).toBe(1)
    expect(out.tardy_count).toBe(0)
  })
  it('re-reprogramar la misma sesion suma eventos (repro_times) y expone el tope', () => {
    const out = buildControlRow(row, {
      ...ctx,
      controls: [
        { program_edition_id: 7, session_number: 1, status: 'R', new_date: '2026-05-27', repro_times: 2 }
      ]
    })
    expect(out.repro_count).toBe(2)
    expect(out.repro_max).toBe(3)
  })
  it('todas dictadas = CULMINÓ; una repro luego dictada sigue contando en Repros', () => {
    const out = buildControlRow(row, {
      ...ctx,
      controls: [
        { program_edition_id: 7, session_number: 1, status: 'A', new_date: '2026-05-20' },
        { program_edition_id: 7, session_number: 2, status: 'A' },
        { program_edition_id: 7, session_number: 3, status: 'T' }
      ]
    })
    expect(out.current_label).toBe('CULMINÓ')
    expect(out.repro_count).toBe(1)
    expect(out.tardy_count).toBe(1)
  })
})

describe('buildWeeklySessionDays', () => {
  it('arma 7 dias lunes-domingo y vuelca las ediciones en su fecha', () => {
    const days = buildWeeklySessionDays({
      date_start: '2026-05-18',
      date_end: '2026-05-24',
      rows: [{
        edition_num_id: 1,
        abbreviation: 'POWER BI',
        cat_day_combination_id: 3012,
        start_date: '2026-05-11',
        end_date: '2026-06-03',
        total_sessions: 8
      }],
      dayCombos: [{ catalog_id: 3012, variable_2: '[1,3]' }],
      holidaySet: new Set()
    })
    expect(days).toHaveLength(7)
    expect(days[0].date).toBe('2026-05-18')
    expect(days[6].date).toBe('2026-05-24')
    expect(days[0].editions[0]).toMatchObject({ abbreviation: 'POWER BI', session_number: 3 })
    expect(days[2].editions[0].session_number).toBe(4)
    expect(days[1].editions).toHaveLength(0)
  })
})

describe('b2bAttendanceSummary (Seguimiento B2B)', () => {
  it('cuenta la tardanza como asistida y calcula sobre lo YA marcado', () => {
    const s = b2bAttendanceSummary({ 1: 'P', 2: 'T', 3: 'F' }, 6)
    expect(s).toMatchObject({ present: 1, tardy: 1, absent: 1, taken: 3, pending: 3 })
    expect(s.pct).toBe(67) // (1 presente + 1 tardanza) / 3 tomadas
  })

  it('sin sesiones marcadas no inventa 0%: pct null y todo pendiente', () => {
    expect(b2bAttendanceSummary({}, 6)).toMatchObject({ pct: null, taken: 0, pending: 6 })
  })

  it('mas marcas que sesiones del curso no da pendientes negativos', () => {
    expect(b2bAttendanceSummary({ 1: 'P', 2: 'P', 3: 'P' }, 2).pending).toBe(0)
  })
})
