import { describe, it, expect } from 'vitest'
import {
  normalizeActive,
  normalizeActiveForCaller,
  sliceCharacter,
  buildProgramPayload,
  extractPaginationMeta
} from '../program.entity.js'

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
  it('mapea booleanos a Y/N', () => {
    expect(normalizeActiveForCaller(true)).toBe('Y')
    expect(normalizeActiveForCaller(false)).toBe('N')
  })
  it('deja pasar strings sin transformar', () => {
    expect(normalizeActiveForCaller('N')).toBe('N')
    expect(normalizeActiveForCaller('')).toBe('')
  })
})

describe('sliceCharacter', () => {
  it('toma el primer caracter de un string', () => {
    expect(sliceCharacter('Marketing')).toBe('M')
  })
  it('castea no-strings y toma el primero', () => {
    expect(sliceCharacter(123)).toBe('1')
  })
  it('devuelve null para null o undefined', () => {
    expect(sliceCharacter(null)).toBeNull()
    expect(sliceCharacter(undefined)).toBeNull()
  })
})

describe('buildProgramPayload', () => {
  const autor = id => ({ user_id: id, user_registration_id: id, user_modification_id: id })
  it('fusiona el autor con las claves que leen los SPs de alta y edicion', () => {
    expect(buildProgramPayload({ program_name: 'X' }, 9)).toEqual({ program_name: 'X', ...autor(9) })
  })
  it('aplica defaults cuando no se pasan argumentos', () => {
    expect(buildProgramPayload()).toEqual(autor(null))
  })
  it('el autor del token sobreescribe el que venga en el program', () => {
    expect(buildProgramPayload({ user_id: 1, user_modification_id: 1 }, 7)).toEqual(autor(7))
  })
})

describe('extractPaginationMeta', () => {
  it('lee total_count del primer row y castea page/size', () => {
    expect(extractPaginationMeta([{ total_count: '42' }], '2', '10')).toEqual({ total: 42, page: 2, size: 10 })
  })
  it('total 0 cuando no hay rows o total_count', () => {
    expect(extractPaginationMeta([], 1, 25)).toEqual({ total: 0, page: 1, size: 25 })
    expect(extractPaginationMeta([{}], 1, 25)).toEqual({ total: 0, page: 1, size: 25 })
  })
})
