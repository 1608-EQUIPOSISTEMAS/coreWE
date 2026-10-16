import { describe, it, expect } from 'vitest'
import { addDays, rankCandidates, distributeSnake, distribute, nextStep, followUpSchedule, lowLevelFollowUps } from '../bandeja.entity.js'
import { probabilityOfReturningClient, RETURNING_CLIENT_PROBABILITY } from '../outlook.entity.js'

const cand = (phone_key, { inquiries = 1, tier = 'BAJO', is_client = false, days = 3, consulted_on = '2026-10-13', owner_id = null } = {}) =>
  ({ phone_key, inquiries, tier, is_client, days, consulted_on, owner_id })

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
  it('entran ALTA y MEDIA; el nuevo con 1 consulta (BAJA) va a la cadencia, no a la llamada', () => {
    const out = rankCandidates([cand('baja'), cand('media', { inquiries: 2 }), cand('alta', { inquiries: 3 }), cand('cliente', { is_client: true })])
    expect(out.map((c) => [c.phone_key, c.level])).toEqual([['alta', 'ALTA'], ['cliente', 'MEDIA'], ['media', 'MEDIA']])
  })

  it('el prospecto que paso los 14 dias no se llama aunque haya consultado 2 veces; el cliente si', () => {
    const out = rankCandidates([cand('frio', { inquiries: 2, days: 40 }), cand('volvio', { is_client: true, days: 40 })])
    expect(out.map((c) => c.phone_key)).toEqual(['volvio'])
  })

  it('dentro del nivel: la consulta mas reciente primero y, a igual fecha, el TOP', () => {
    const out = rankCandidates([
      cand('vieja', { inquiries: 2, consulted_on: '2026-10-10' }),
      cand('bajo', { inquiries: 2, consulted_on: '2026-10-14' }),
      cand('top', { inquiries: 2, consulted_on: '2026-10-14', tier: 'TOP' })
    ])
    expect(out.map((c) => c.phone_key)).toEqual(['top', 'bajo', 'vieja'])
  })

  it('el cliente viejo conserva la probabilidad medida (4.4 / 9) para la medicion', () => {
    const [c] = rankCandidates([cand('v', { is_client: true, days: 40, inquiries: 2 })])
    expect(c).toMatchObject({ level: 'ALTA', fresh: false, probability: RETURNING_CLIENT_PROBABILITY.repeated })
  })
})

describe('distribute', () => {
  const advisors = [{ user_id: 1, open: 0 }, { user_id: 2, open: 0 }]

  it('la consulta fresca se queda con el asesor que la registro; el resto, en serpiente', () => {
    const ranked = rankCandidates([
      cand('suyo', { inquiries: 3, owner_id: 2 }),
      cand('web', { inquiries: 2, owner_id: 99 }),
      cand('viejo', { is_client: true, days: 40, owner_id: 2 })
    ])
    const by = Object.fromEntries(distribute({ ranked, advisors }).map((a) => [a.phone_key, a.user_id]))
    expect(by.suyo).toBe(2)
    // WEB no es asesor y el cliente viejo se reparte: los dos van por serpiente.
    expect(by).toMatchObject({ viejo: 1, web: 2 })
  })

  it('el dueño tambien tiene tope: se queda con sus mejores y lo demas no se le pasa a otro', () => {
    const ranked = rankCandidates([
      cand('a', { inquiries: 3, owner_id: 1 }), cand('b', { inquiries: 2, owner_id: 1 }), cand('c', { inquiries: 2, owner_id: 1 }),
      cand('viejo', { is_client: true, days: 40 })
    ])
    const out = distribute({ ranked, advisors: [{ user_id: 1, open: 0 }, { user_id: 2, open: 0 }], maxOpen: 2 })
    expect(out.map((a) => `${a.phone_key}:${a.user_id}`)).toEqual(['a:1', 'b:1', 'viejo:2'])
  })

})

describe('nextStep', () => {
  const today = '2026-10-16'

  it('no contesta: vuelve mañana; al tercer intento deja de llamar y arranca la cadencia', () => {
    expect(nextStep({ outcome: 'NO_CONTESTA', attempts: 0, today })).toMatchObject({ close: null, attempts: 1, nextContactOn: '2026-10-17' })
    expect(nextStep({ outcome: 'NO_CONTESTA', attempts: 2, today })).toMatchObject({ close: 'SIN_RESPUESTA', attempts: 3, startFollowUp: true })
  })

  it('lo pienso y caro: vuelve en 3 dias, sin cerrar', () => {
    expect(nextStep({ outcome: 'LO_PIENSO', attempts: 0, today })).toMatchObject({ close: null, nextContactOn: '2026-10-19' })
    expect(nextStep({ outcome: 'CARO', attempts: 1, today })).toMatchObject({ close: null, attempts: 1, nextContactOn: '2026-10-19' })
  })

  it('inscrito, otro programa, no le interesa y numero errado cierran', () => {
    for (const outcome of ['INSCRITO', 'OTRO_PROGRAMA', 'NO_INTERESA', 'NUMERO_ERRADO']) {
      expect(nextStep({ outcome, attempts: 0, today }).close).toBe(outcome)
    }
  })
})

describe('followUpSchedule', () => {
  it('dias 1, 3 y 7 desde el ancla', () => {
    expect(followUpSchedule('2026-10-30').map((f) => f.due_on)).toEqual(['2026-10-31', '2026-11-02', '2026-11-06'])
  })
})

describe('lowLevelFollowUps', () => {
  const advisors = [{ user_id: 1 }, { user_id: 2 }]
  const today = '2026-10-16'

  it('solo el nuevo con 1 consulta de la ultima semana, con los pasos que faltan', () => {
    const out = lowLevelFollowUps({
      advisors, today,
      candidates: [
        cand('ayer', { consulted_on: '2026-10-15', days: 1, owner_id: 2 }),
        cand('hace4', { consulted_on: '2026-10-12', days: 4, owner_id: 2 }),
        cand('dos', { inquiries: 2, consulted_on: '2026-10-15', days: 1 }),
        cand('cliente', { is_client: true, consulted_on: '2026-10-15', days: 1 }),
        cand('vieja', { consulted_on: '2026-10-01', days: 15 })
      ]
    })
    expect(out.map((f) => `${f.phone_key}:${f.step}`)).toEqual(['ayer:1', 'ayer:3', 'ayer:7', 'hace4:7'])
    expect(out.every((f) => f.user_id === 2 && f.reason === 'BAJA')).toBe(true)
  })

  it('si la consulta no es de un asesor, se reparte en ronda', () => {
    const out = lowLevelFollowUps({
      advisors, today,
      candidates: [cand('a', { consulted_on: '2026-10-15', days: 1, owner_id: 99 }), cand('b', { consulted_on: '2026-10-15', days: 1, owner_id: 99 })]
    })
    expect([...new Set(out.map((f) => `${f.phone_key}:${f.user_id}`))]).toEqual(['a:1', 'b:2'])
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
