import { describe, it, expect } from 'vitest'
import { DomainError } from '../../../../shared/errors.js'
import {
  resolveCreateState,
  isInstallmentInscription,
  inscriptionFullName,
  assertGroupable,
  MAX_TOKENS_PER_GROUP,
  MAX_GROUP_AMOUNT
} from '../token.entity.js'

// Fabrica de filas de payment_tokens validas para agrupar. Cada test rompe un
// solo campo para aislar la regla que valida.
const tokenRow = (over = {}) => ({
  token_id: 1,
  status: 'pending',
  payment_url: null,
  requested_by: 7,
  currency: 'PEN',
  cat_provider: 100,
  payment_type: 'credit',
  amount: 500,
  group_id: null,
  ...over
})

const pair = (a = {}, b = {}) => [tokenRow({ token_id: 1, ...a }), tokenRow({ token_id: 2, ...b })]

describe('resolveCreateState', () => {
  it('sin link: pendiente y solicitado por el asesor', () => {
    expect(resolveCreateState({ paymentUrl: null, userId: 9 }))
      .toEqual({ status: 'pending', requestedBy: 9, createdBy: null })
  })
  it('con link: enviado y creado por FICO', () => {
    expect(resolveCreateState({ paymentUrl: 'http://pay', userId: 9 }))
      .toEqual({ status: 'link_sent', requestedBy: null, createdBy: 9 })
  })
})

describe('isInstallmentInscription', () => {
  it('es cuotas si hay plan y adelanto', () => {
    expect(isInstallmentInscription({ installment_plan: [{}], saved_money: 100 })).toBe(true)
  })
  it('no es cuotas sin adelanto o sin plan', () => {
    expect(isInstallmentInscription({ installment_plan: [{}], saved_money: 0 })).toBe(false)
    expect(isInstallmentInscription({ installment_plan: [], saved_money: 100 })).toBe(false)
    expect(isInstallmentInscription({})).toBe(false)
  })
})

describe('inscriptionFullName', () => {
  it('une nombre, paterno y materno', () => {
    expect(inscriptionFullName({ inscription: { full_name: 'Ana', last_name: 'Diaz', mother_last_name: 'Ruiz' } }))
      .toBe('Ana Diaz Ruiz')
  })
  it('devuelve null si no hay datos', () => {
    expect(inscriptionFullName({})).toBeNull()
    expect(inscriptionFullName({ inscription: {} })).toBeNull()
  })
})

describe('assertGroupable (contribucion)', () => {
  it('acepta un conjunto coherente y devuelve total/currency/count', () => {
    const result = assertGroupable(pair({ amount: 500 }, { amount: 700 }), 7)
    expect(result).toEqual({ total: 1200, currency: 'PEN', count: 2 })
  })

  it('rechaza menos de 2 tokens', () => {
    expect(() => assertGroupable([tokenRow()], 7)).toThrow(DomainError)
  })

  it('el limite de agrupacion acordado con FICO es 10', () => {
    expect(MAX_TOKENS_PER_GROUP).toBe(10)
  })

  it(`acepta exactamente ${MAX_TOKENS_PER_GROUP} tokens`, () => {
    // 10 x 300 = 3000, justo en MAX_GROUP_AMOUNT: aisla la regla de cantidad
    // sin que la de monto la tape.
    const max = Array.from({ length: MAX_TOKENS_PER_GROUP }, (_, i) => tokenRow({ token_id: i + 1, amount: 300 }))
    expect(assertGroupable(max, 7).count).toBe(MAX_TOKENS_PER_GROUP)
  })

  it(`rechaza mas de ${MAX_TOKENS_PER_GROUP} tokens con un mensaje que nombra el limite`, () => {
    const many = Array.from({ length: MAX_TOKENS_PER_GROUP + 1 }, (_, i) => tokenRow({ token_id: i + 1, amount: 1 }))
    expect(() => assertGroupable(many, 7)).toThrow(DomainError)
    // El asesor tiene que leer cuantos puede agrupar y cuantos selecciono, no
    // un "Datos invalidos" generico.
    expect(() => assertGroupable(many, 7))
      .toThrow(`El limite de agrupacion es de ${MAX_TOKENS_PER_GROUP} tokens por grupo (seleccionaste ${MAX_TOKENS_PER_GROUP + 1})`)
  })

  it('rechaza tokens de otro asesor', () => {
    expect(() => assertGroupable(pair({}, { requested_by: 99 }), 7)).toThrow(DomainError)
  })

  it('rechaza tokens que no estan pending', () => {
    expect(() => assertGroupable(pair({}, { status: 'link_sent' }), 7)).toThrow(DomainError)
  })

  it('rechaza tokens que ya tienen link', () => {
    expect(() => assertGroupable(pair({}, { payment_url: 'http://pay' }), 7)).toThrow(DomainError)
  })

  it('rechaza tokens que ya estan en un grupo', () => {
    expect(() => assertGroupable(pair({}, { group_id: 'abc' }), 7)).toThrow(DomainError)
  })

  it('rechaza monedas distintas', () => {
    expect(() => assertGroupable(pair({}, { currency: 'USD' }), 7)).toThrow(DomainError)
  })

  it('rechaza proveedores distintos', () => {
    expect(() => assertGroupable(pair({}, { cat_provider: 200 }), 7)).toThrow(DomainError)
  })

  it('rechaza tipos de pago distintos', () => {
    expect(() => assertGroupable(pair({}, { payment_type: 'debit' }), 7)).toThrow(DomainError)
  })

  it(`rechaza un total mayor a ${MAX_GROUP_AMOUNT}`, () => {
    expect(() => assertGroupable(pair({ amount: 2000 }, { amount: 2000 }), 7)).toThrow(DomainError)
  })
})
