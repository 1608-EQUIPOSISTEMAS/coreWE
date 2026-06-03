import { describe, it, expect } from 'vitest'
import {
  splitNullSentinel,
  normalizeActive,
  buildFilterPayload,
  buildStatsFilterPayload,
  sanitizeFilename,
  buildUniqueFilename,
  detectChannelAlias,
  normalizeActiveProgramVersion,
  buildEditionFilterPayload
} from '../comercial.entity.js'

describe('splitNullSentinel', () => {
  it('separa el centinela -1 del resto de IDs', () => {
    expect(splitNullSentinel([1, -1, 2])).toEqual({ ids: [1, 2], includeNull: true })
  })
  it('sin centinela no incluye null', () => {
    expect(splitNullSentinel([3, 4])).toEqual({ ids: [3, 4], includeNull: false })
  })
  it('array vacio o no-array devuelve defaults', () => {
    expect(splitNullSentinel([])).toEqual({ ids: [], includeNull: false })
    expect(splitNullSentinel(null)).toEqual({ ids: [], includeNull: false })
    expect(splitNullSentinel(undefined)).toEqual({ ids: [], includeNull: false })
  })
})

describe('normalizeActive', () => {
  it('mapea booleanos a Y/N', () => {
    expect(normalizeActive(true)).toBe('Y')
    expect(normalizeActive(false)).toBe('N')
  })
  it('deja pasar el resto tal cual', () => {
    expect(normalizeActive('Y')).toBe('Y')
    expect(normalizeActive(null)).toBeNull()
  })
})

describe('buildFilterPayload', () => {
  it('mapea user_id a current_user_id y aplica defaults de paginacion', () => {
    const f = buildFilterPayload({ user_id: 7 })
    expect(f.current_user_id).toBe(7)
    expect(f.page).toBe(1)
    expect(f.size).toBe(25)
    expect(f.order_by).toBe(0)
  })

  it('convierte el booleano active a Y/N', () => {
    expect(buildFilterPayload({ active: true }).active).toBe('Y')
    expect(buildFilterPayload({ active: false }).active).toBe('N')
  })

  it('desdobla centinelas -1 en flags include_null', () => {
    const f = buildFilterPayload({ prospect_situation_ids: [5, -1], strategy_ids: [9] })
    expect(f.prospect_situation_ids).toEqual([5])
    expect(f.include_null_situation).toBe(true)
    expect(f.strategy_ids).toEqual([9])
    expect(f.include_null_strategy).toBe(false)
  })

  it('cae a array vacio en los multiselect simples ausentes', () => {
    const f = buildFilterPayload({})
    expect(f.owner_user_ids).toEqual([])
    expect(f.payment_channel_ids).toEqual([])
    expect(f.settlement_status_ids).toEqual([])
  })
})

describe('buildStatsFilterPayload', () => {
  it('no incluye campos de pay_date', () => {
    const f = buildStatsFilterPayload({ pay_date_from: '2026-01-01' })
    expect(f).not.toHaveProperty('pay_date_from')
    expect(f).not.toHaveProperty('pay_date_to')
  })
  it('normaliza active y rellena arrays', () => {
    const f = buildStatsFilterPayload({ active: false })
    expect(f.active).toBe('N')
    expect(f.owner_user_ids).toEqual([])
    expect(f.word_ids).toEqual([])
  })
})

describe('sanitizeFilename', () => {
  it('reemplaza caracteres no seguros por guion bajo', () => {
    expect(sanitizeFilename('mi archivo (1).pdf')).toBe('mi_archivo__1_.pdf')
  })
  it('conserva letras, numeros y puntos', () => {
    expect(sanitizeFilename('Foto123.JPG')).toBe('Foto123.JPG')
  })
})

describe('buildUniqueFilename', () => {
  it('antepone la marca de tiempo al nombre saneado', () => {
    expect(buildUniqueFilename('a b.png', 1000)).toBe('1000_a_b.png')
  })
})

describe('detectChannelAlias', () => {
  it('detecta web y general', () => {
    expect(detectChannelAlias('we_channel_web')).toBe('web')
    expect(detectChannelAlias('we_channel_general')).toBe('general')
  })
  it('cualquier otro alias es other', () => {
    expect(detectChannelAlias('we_channel_walkin')).toBe('other')
    expect(detectChannelAlias(null)).toBe('other')
    expect(detectChannelAlias(undefined)).toBe('other')
  })
})

describe('normalizeActiveProgramVersion', () => {
  it('mapea booleanos, conserva strings y cae a null', () => {
    expect(normalizeActiveProgramVersion(true)).toBe('Y')
    expect(normalizeActiveProgramVersion(false)).toBe('N')
    expect(normalizeActiveProgramVersion('Y')).toBe('Y')
    expect(normalizeActiveProgramVersion(null)).toBeNull()
    expect(normalizeActiveProgramVersion(undefined)).toBeNull()
  })
})

describe('buildEditionFilterPayload', () => {
  it('multiselect ausentes caen a array vacio y simples a null', () => {
    const f = buildEditionFilterPayload({})
    expect(f.category_ids).toEqual([])
    expect(f.instructores_seleccionados).toEqual([])
    expect(f.program_version_id).toBeNull()
    expect(f.page).toBe(1)
    expect(f.size).toBe(25)
  })
  it('normaliza el booleano active', () => {
    expect(buildEditionFilterPayload({ active: true }).active).toBe('Y')
    expect(buildEditionFilterPayload({ active: false }).active).toBe('N')
  })
})
