import { describe, it, expect } from 'vitest'
import {
  assertSpResult,
  firstRowOrEmpty,
  rowsOrEmpty,
  normalizeCompanyLeadPayload,
  normalizeLeadId,
  normalizeDiscounts
} from '../b2b.entity.js'

describe('assertSpResult', () => {
  it('devuelve la primera fila cuando existe', () => {
    expect(assertSpResult([{ result: 1, id: 9 }])).toEqual({ result: 1, id: 9 })
  })
  it('cae al fallback cuando no hay filas', () => {
    expect(assertSpResult([])).toEqual({ result: 0, message: 'No response from DB' })
    expect(assertSpResult(null)).toEqual({ result: 0, message: 'No response from DB' })
    expect(assertSpResult(undefined)).toEqual({ result: 0, message: 'No response from DB' })
  })
})

describe('firstRowOrEmpty', () => {
  it('devuelve la primera fila o objeto vacio', () => {
    expect(firstRowOrEmpty([{ a: 1 }])).toEqual({ a: 1 })
    expect(firstRowOrEmpty([])).toEqual({})
    expect(firstRowOrEmpty(null)).toEqual({})
  })
})

describe('rowsOrEmpty', () => {
  it('devuelve las filas o arreglo vacio', () => {
    const rows = [{ a: 1 }, { a: 2 }]
    expect(rowsOrEmpty(rows)).toBe(rows)
    expect(rowsOrEmpty(null)).toEqual([])
    expect(rowsOrEmpty(undefined)).toEqual([])
  })
})

describe('normalizeCompanyLeadPayload', () => {
  it('separa lead, contact_attempts y user_registration_id', () => {
    const out = normalizeCompanyLeadPayload({
      lead: { name: 'ACME' },
      contact_attempts: [{ via: 'phone' }],
      user_registration_id: 7
    })
    expect(out).toEqual({
      lead: { name: 'ACME' },
      contactAttempts: [{ via: 'phone' }],
      userRegistrationId: 7
    })
  })
  it('aplica defaults cuando faltan campos', () => {
    const out = normalizeCompanyLeadPayload({})
    expect(out.lead).toEqual({})
    expect(out.contactAttempts).toEqual([])
    expect(out.userRegistrationId).toBeUndefined()
  })
  it('tolera payload ausente', () => {
    expect(normalizeCompanyLeadPayload()).toEqual({
      lead: {},
      contactAttempts: [],
      userRegistrationId: undefined
    })
  })
})

describe('normalizeLeadId', () => {
  it('castea strings numericas y enteros', () => {
    expect(normalizeLeadId('123')).toBe(123)
    expect(normalizeLeadId(45)).toBe(45)
  })
  it('devuelve null para valores no enteros', () => {
    expect(normalizeLeadId('abc')).toBeNull()
    expect(normalizeLeadId(undefined)).toBeNull()
    expect(normalizeLeadId(null)).toBeNull()
    expect(normalizeLeadId(1.5)).toBeNull()
  })
})

describe('normalizeDiscounts', () => {
  it('respeta arrays existentes', () => {
    const d = [{ id: 1 }]
    expect(normalizeDiscounts(d)).toBe(d)
  })
  it('cae a array vacio cuando no es array', () => {
    expect(normalizeDiscounts(undefined)).toEqual([])
    expect(normalizeDiscounts(null)).toEqual([])
    expect(normalizeDiscounts({})).toEqual([])
  })
})
