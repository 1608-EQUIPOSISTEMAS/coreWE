import { describe, it, expect } from 'vitest'
import {
  normalizeActive,
  normalizeActiveForCaller
} from '../corporate_agreement.entity.js'

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
