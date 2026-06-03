import { describe, it, expect } from 'vitest'
import { DomainError } from '../../../../shared/errors.js'
import {
  MEMBERSHIP_ACTIVATION_WINDOW_MONTHS,
  isMembership,
  validateActivationDateFormat,
  classifyActivation,
  outOfWindowMessage,
  isActivationDeferred,
  assertReschedulable
} from '../membership.entity.js'

describe('isMembership (flag explicito prioritario)', () => {
  it('el flag true manda sobre el nombre', () => {
    expect(isMembership('PROGRAMA REGULAR', true)).toBe(true)
  })
  it('el flag false manda aunque el nombre parezca membresia', () => {
    expect(isMembership('MEMBRESIA GOLD', false)).toBe(false)
  })
  it('sin flag cae a la heuristica de nombre', () => {
    expect(isMembership('CLUB GOLD')).toBe(true)
    expect(isMembership('DIPLOMADO X')).toBe(false)
  })
})

describe('validateActivationDateFormat', () => {
  it('acepta YYYY-MM-DD y devuelve el valor trimmeado', () => {
    expect(validateActivationDateFormat('  2026-06-01 ')).toEqual({ ok: true, value: '2026-06-01' })
  })
  it('rechaza formatos no calendario', () => {
    expect(validateActivationDateFormat('01/06/2026').ok).toBe(false)
    expect(validateActivationDateFormat('2026-6-1').ok).toBe(false)
    expect(validateActivationDateFormat(null).ok).toBe(false)
  })
})

describe('classifyActivation', () => {
  it('fuera de ventana tiene prioridad sobre todo', () => {
    expect(classifyActivation({ isTodayOrPast: true, outOfWindow: true, activationDate: '2027-01-01', runAt: 'x' }))
      .toEqual({ mode: 'out_of_window' })
  })
  it('hoy o pasado es inmediato (flujo sincrono)', () => {
    expect(classifyActivation({ isTodayOrPast: true, outOfWindow: false, activationDate: '2026-05-29', runAt: 'x' }))
      .toEqual({ mode: 'immediate', activationDate: '2026-05-29' })
  })
  it('futuro dentro de ventana es diferido (job a las 09:00)', () => {
    expect(classifyActivation({ isTodayOrPast: false, outOfWindow: false, activationDate: '2026-08-01', runAt: 'RUNAT' }))
      .toEqual({ mode: 'deferred', activationDate: '2026-08-01', runAt: 'RUNAT' })
  })
})

describe('outOfWindowMessage', () => {
  it('menciona la ventana de meses configurada', () => {
    expect(outOfWindowMessage()).toContain(String(MEMBERSHIP_ACTIVATION_WINDOW_MONTHS))
  })
})

describe('isActivationDeferred (defensa pura)', () => {
  it('true cuando la fecha es estrictamente futura', () => {
    expect(isActivationDeferred('2026-08-01', '2026-05-29')).toBe(true)
  })
  it('false cuando es hoy o pasado', () => {
    expect(isActivationDeferred('2026-05-29', '2026-05-29')).toBe(false)
    expect(isActivationDeferred('2026-01-01', '2026-05-29')).toBe(false)
  })
  it('false cuando no hay fecha de activacion', () => {
    expect(isActivationDeferred(null, '2026-05-29')).toBe(false)
  })
})

describe('assertReschedulable', () => {
  const future = { mode: 'deferred', activationDate: '2026-08-01', runAt: 'x' }

  it('no lanza cuando es membresia, sin correo enviado y fecha futura valida', () => {
    expect(() => assertReschedulable(
      { found: true, isMembershipProgram: true, emailAlreadySent: false }, future
    )).not.toThrow()
  })

  it('lanza NotFound cuando la inscripcion no existe', () => {
    try {
      assertReschedulable({ found: false, isMembershipProgram: false, emailAlreadySent: false }, future)
      throw new Error('debio lanzar')
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError)
      expect(e.statusCode).toBe(404)
    }
  })

  it('lanza si la inscripcion no es membresia', () => {
    expect(() => assertReschedulable(
      { found: true, isMembershipProgram: false, emailAlreadySent: false }, future
    )).toThrow(DomainError)
  })

  it('lanza si el correo de bienvenida ya fue enviado', () => {
    expect(() => assertReschedulable(
      { found: true, isMembershipProgram: true, emailAlreadySent: true }, future
    )).toThrow(/correo de bienvenida ya fue enviado/i)
  })

  it('lanza si la fecha es hoy o pasado (debe usar envio directo)', () => {
    expect(() => assertReschedulable(
      { found: true, isMembershipProgram: true, emailAlreadySent: false },
      { mode: 'immediate', activationDate: '2026-05-29' }
    )).toThrow(/posterior a hoy/i)
  })

  it('lanza si la fecha excede la ventana permitida', () => {
    expect(() => assertReschedulable(
      { found: true, isMembershipProgram: true, emailAlreadySent: false },
      { mode: 'out_of_window' }
    )).toThrow(/ventana permitida/i)
  })
})
