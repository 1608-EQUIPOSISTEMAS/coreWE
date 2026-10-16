import { describe, it, expect } from 'vitest'
import { addDays, rankCandidates, distributeSnake } from '../bandeja.entity.js'
import { probabilityOfReturningClient, RETURNING_CLIENT_PROBABILITY } from '../outlook.entity.js'

const cand = (phone_key, inquiries, tier) => ({ phone_key, inquiries, tier })

describe('addDays', () => {
  it('cruza mes y año sin correr el dia', () => {
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('probabilityOfReturningClient', () => {
  it('2+ consultas del mismo programa duplica la probabilidad (medido: 9% vs 4.4%)', () => {
    expect(probabilityOfReturningClient(1)).toBe(RETURNING_CLIENT_PROBABILITY.single)
    expect(probabilityOfReturningClient(3)).toBe(RETURNING_CLIENT_PROBABILITY.repeated)
  })
})

describe('rankCandidates', () => {
  it('ordena por probabilidad x valor: TOP de 1 consulta antes que BAJO de 1, el de 2+ antes que todos', () => {
    const out = rankCandidates([cand('a', 1, 'BAJO'), cand('b', 1, 'TOP'), cand('c', 2, 'BAJO')])
    // c: 9 x 0.5 = 4.5 ; b: 4.4 x 1 = 4.4 ; a: 4.4 x 0.5 = 2.2
    expect(out.map((c) => c.phone_key)).toEqual(['c', 'b', 'a'])
  })

  it('sin nivel se trata como BAJO', () => {
    expect(rankCandidates([cand('a', 1, null)])[0].tier).toBe('BAJO')
  })
})

describe('distributeSnake', () => {
  const ranked = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((phone_key) => ({ phone_key }))

  it('reparte en serpiente: nadie se lleva siempre el mejor de la vuelta', () => {
    const out = distributeSnake({ ranked, advisors: [{ user_id: 1, open: 0 }, { user_id: 2, open: 0 }, { user_id: 3, open: 0 }] })
    const de = (u) => out.filter((a) => a.user_id === u).map((a) => a.phone_key)
    expect(de(1)).toEqual(['r1', 'r6'])
    expect(de(2)).toEqual(['r2', 'r5'])
    expect(de(3)).toEqual(['r3', 'r4'])
  })

  it('respeta el tope contando lo que el asesor ya tiene abierto', () => {
    const out = distributeSnake({ ranked, advisors: [{ user_id: 1, open: 19 }, { user_id: 2, open: 20 }], maxOpen: 20 })
    expect(out.map((a) => a.user_id)).toEqual([1])
  })

  it('sin asesores no asigna nada', () => {
    expect(distributeSnake({ ranked, advisors: [] })).toEqual([])
  })
})
