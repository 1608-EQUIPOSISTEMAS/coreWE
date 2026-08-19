import { describe, it, expect } from 'vitest'
import {
  assertSpResult,
  firstRowOrEmpty,
  rowsOrEmpty,
  normalizeCompanyLeadPayload,
  normalizeId,
  summarizeEnrollment,
  toPaginated
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

describe('normalizeId', () => {
  it('castea strings numericas y enteros', () => {
    expect(normalizeId('123')).toBe(123)
    expect(normalizeId(45)).toBe(45)
  })
  it('devuelve null para valores no enteros', () => {
    expect(normalizeId('abc')).toBeNull()
    expect(normalizeId(undefined)).toBeNull()
    expect(normalizeId(null)).toBeNull()
    expect(normalizeId(1.5)).toBeNull()
  })
})


describe('summarizeEnrollment', () => {
  const filas = [
    { beneficiary_id: 1, estado: 'creado', enrollment_id: 900 },
    { beneficiary_id: 2, estado: 'ya_matriculado', enrollment_id: 800 },
    { beneficiary_id: 3, estado: 'sin_programa' },
    { beneficiary_id: 4, estado: 'creado', enrollment_id: 901 },
    { beneficiary_id: 5, estado: 'error', mensaje: 'boom' }
  ]

  it('cuenta creados, ya matriculados y rechazados por separado', () => {
    const r = summarizeEnrollment(filas)
    expect(r.enrolled).toBe(2)
    expect(r.skipped).toBe(1)
    expect(r.rejected).toBe(2)
  })

  it('pone los rechazados al frente: son los que dejan al alumno fuera del aula', () => {
    const r = summarizeEnrollment(filas)
    expect(r.detail.slice(0, 2).map(f => f.beneficiary_id)).toEqual([3, 5])
    expect(r.detail).toHaveLength(filas.length)
  })

  it('un envio sin cupos no revienta', () => {
    expect(summarizeEnrollment()).toEqual({ enrolled: 0, skipped: 0, rejected: 0, detail: [] })
  })
})

describe('toPaginated', () => {
  it('arma el envelope que leen las pantallas y saca el total de total_count', () => {
    const rows = [{ company_id: 1, total_count: '399' }, { company_id: 2, total_count: '399' }]
    expect(toPaginated(rows, { page: '2', size: '20' }))
      .toEqual({ total: 399, page: 2, size: 20, items: rows })
  })

  it('sin filas devuelve items vacio, no undefined', () => {
    expect(toPaginated(null, {})).toEqual({ total: 0, page: 1, size: 0, items: [] })
  })
})
