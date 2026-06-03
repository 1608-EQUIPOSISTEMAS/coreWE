import { describe, it, expect } from 'vitest'
import {
  normalizeValue,
  paginationDefaults,
  buildListItem,
  buildGetResult,
  buildCallerItem
} from '../discount.entity.js'

describe('normalizeValue', () => {
  it('convierte strings numericos a Number', () => {
    expect(normalizeValue('10')).toBe(10)
    expect(normalizeValue('50.5')).toBe(50.5)
  })
  it('devuelve null para nulo o indefinido', () => {
    expect(normalizeValue(null)).toBeNull()
    expect(normalizeValue(undefined)).toBeNull()
  })
  it('preserva el 0', () => {
    expect(normalizeValue(0)).toBe(0)
  })
})

describe('paginationDefaults', () => {
  it('aplica defaults page 1 y size 25', () => {
    expect(paginationDefaults({})).toEqual({ page: 1, size: 25 })
    expect(paginationDefaults()).toEqual({ page: 1, size: 25 })
  })
  it('normaliza page menor a 1 a 1', () => {
    expect(paginationDefaults({ page: 0 })).toEqual({ page: 1, size: 25 })
    expect(paginationDefaults({ page: -3 })).toEqual({ page: 1, size: 25 })
  })
  it('respeta valores validos', () => {
    expect(paginationDefaults({ page: 2, size: 50 })).toEqual({ page: 2, size: 50 })
  })
  it('normaliza size invalido al default', () => {
    expect(paginationDefaults({ size: 0 })).toEqual({ page: 1, size: 25 })
  })
})

describe('buildListItem', () => {
  it('mapea r.id al campo discount_id', () => {
    const item = buildListItem({ id: 7, discount_id: 99, value: '10' })
    expect(item.discount_id).toBe(7)
    expect(item.value).toBe(10)
  })
  it('proyecta tipo, moneda y fechas', () => {
    const row = {
      id: 1,
      description: 'Beca',
      alias: 'beca',
      value: '20',
      value_formatted: '20%',
      cat_discount_type: 5,
      cat_discount_type_alias: 'we_discount_type_percentage',
      cat_discount_type_label: 'Porcentaje',
      cat_currency_type: 3,
      cat_currency_type_alias: 'we_currency_soles',
      cat_currency_type_label: 'Soles',
      is_global: true,
      campaign_id: 12,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      active: true
    }
    const item = buildListItem(row)
    expect(item).toEqual({
      discount_id: 1,
      description: 'Beca',
      alias: 'beca',
      value: 20,
      value_formatted: '20%',
      cat_discount_type_id: 5,
      cat_discount_type_alias: 'we_discount_type_percentage',
      cat_discount_type_label: 'Porcentaje',
      cat_currency_type_id: 3,
      cat_currency_type_alias: 'we_currency_soles',
      cat_currency_type_label: 'Soles',
      is_global: true,
      campaign_id: 12,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      active: true
    })
  })
})

describe('buildGetResult', () => {
  it('cae a [] cuando programs es NULL', () => {
    expect(buildGetResult({ programs: null }).programs).toEqual([])
    expect(buildGetResult({}).programs).toEqual([])
  })
  it('preserva el array de programs y normaliza value', () => {
    const res = buildGetResult({ value: '15', programs: [{ program_id: 1 }] })
    expect(res.value).toBe(15)
    expect(res.programs).toEqual([{ program_id: 1 }])
  })
  it('proyecta campos de detalle', () => {
    const res = buildGetResult({
      discount_id: 9,
      status_calc: 'VIGENTE',
      start_date_fmt: '01/01/2026',
      end_date_fmt: '31/12/2026'
    })
    expect(res.discount_id).toBe(9)
    expect(res.status_calc).toBe('VIGENTE')
    expect(res.start_date_fmt).toBe('01/01/2026')
    expect(res.end_date_fmt).toBe('31/12/2026')
  })
})

describe('buildCallerItem', () => {
  it('proyecta el DTO de seleccion con value numerico', () => {
    const item = buildCallerItem({
      id: 2,
      description: 'Beca',
      alias: 'beca',
      value: '20',
      full_label: 'Beca (20%)',
      type_label: 'Porcentaje',
      currency_alias: 'we_currency_soles'
    })
    expect(item).toEqual({
      id: 2,
      description: 'Beca',
      alias: 'beca',
      value: 20,
      full_label: 'Beca (20%)',
      type_label: 'Porcentaje',
      currency_alias: 'we_currency_soles'
    })
  })
})
