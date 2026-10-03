import { describe, it, expect } from 'vitest'
import { cursorNameFor } from '../spHelper.js'

describe('cursorNameFor', () => {
  it('es el mismo para el mismo SP (pg_stat_statements agrupa el FETCH por SP)', () => {
    expect(cursorNameFor('public.sp_comercial_lead_list')).toBe('cur_public_sp_comercial_lead_list')
    expect(cursorNameFor('public.sp_comercial_lead_list')).toBe(cursorNameFor('public.sp_comercial_lead_list'))
  })
  it('es un identificador SQL valido y no pasa de 63 caracteres', () => {
    const name = cursorNameFor('public."Sp-Raro"; DROP TABLE x' + 'a'.repeat(80))
    expect(name).toMatch(/^[a-z0-9_]+$/)
    expect(name.length).toBeLessThanOrEqual(63)
  })
})
