import { describe, it, expect } from 'vitest'
import {
  TONE, median, ratioOf, percentOf, toneHigherIsBetter, toneLowerIsBetter, businessDays, goalProgress
} from '../results.entity.js'

describe('median', () => {
  it('impar, par y sin datos', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([1, 2, 3, 10])).toBe(2.5)
    expect(median([])).toBeNull()
  })

  it('ignora lo que no es número', () => {
    expect(median([null, '4', undefined, 2])).toBe(3)
  })
})

describe('ratioOf / percentOf', () => {
  it('sin referencia no inventa un ratio', () => {
    expect(ratioOf(12, 10)).toBeCloseTo(1.2)
    expect(ratioOf(12, 0)).toBeNull()
    expect(ratioOf(12, null)).toBeNull()
    expect(ratioOf(null, 10)).toBeNull()
  })

  it('porcentaje con un decimal', () => {
    expect(percentOf(1, 3)).toBe(33.3)
    expect(percentOf(5, 0)).toBeNull()
  })
})

describe('tonos', () => {
  it('más es mejor: verde desde la referencia, ámbar hasta 10% abajo', () => {
    expect(toneHigherIsBetter(1.2)).toBe(TONE.OK)
    expect(toneHigherIsBetter(0.92)).toBe(TONE.WARN)
    expect(toneHigherIsBetter(0.5)).toBe(TONE.BAD)
    expect(toneHigherIsBetter(null)).toBeNull()
  })

  it('menos es mejor: la bandeja que crece es la que se pinta de rojo', () => {
    expect(toneLowerIsBetter(0.8)).toBe(TONE.OK)
    expect(toneLowerIsBetter(1.05)).toBe(TONE.WARN)
    expect(toneLowerIsBetter(1.5)).toBe(TONE.BAD)
  })
})

describe('businessDays', () => {
  it('lunes 14/09/2026: 10 hábiles transcurridos de 22', () => {
    expect(businessDays(new Date(2026, 8, 14, 12))).toEqual({ transcurridos: 10, delMes: 22 })
  })

  it('un sábado no suma día hábil', () => {
    expect(businessDays(new Date(2026, 8, 19, 12)).transcurridos)
      .toBe(businessDays(new Date(2026, 8, 18, 12)).transcurridos)
  })
})

describe('goalProgress', () => {
  const mitadDeMes = { transcurridos: 11, delMes: 22 }

  it('50% de avance a mitad de mes es ir al día', () => {
    expect(goalProgress({ logrado: 50, meta: 100, ...mitadDeMes }))
      .toEqual({ pct: 50, esperado: 50, proyeccion: 100, tono: TONE.OK })
  })

  it('hasta 10 puntos abajo de lo esperado es ámbar; más, rojo', () => {
    expect(goalProgress({ logrado: 42, meta: 100, ...mitadDeMes }).tono).toBe(TONE.WARN)
    expect(goalProgress({ logrado: 30, meta: 100, ...mitadDeMes }).tono).toBe(TONE.BAD)
  })

  it('sin meta solo proyecta, sin semáforo', () => {
    expect(goalProgress({ logrado: 30, meta: 0, ...mitadDeMes }))
      .toEqual({ pct: null, esperado: null, proyeccion: 60, tono: null })
  })
})
