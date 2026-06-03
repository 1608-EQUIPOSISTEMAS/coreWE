import { describe, it, expect } from 'vitest'
import {
  targetInstallmentNumber,
  isIdempotencyEligible,
  isPaidStatusAlias,
  isValidActivationDateFormat,
  resolveMembershipActivationDecision,
  PAID_STATUS_ALIASES,
  MEMBERSHIP_ACTIVATION_WINDOW_MONTHS,
  CONFIRM_CONTADO,
  CONFIRM_PLAN
} from '../payment-confirmation.entity.js'

describe('targetInstallmentNumber', () => {
  it('confirm_contado paga la cuota 1', () => {
    expect(targetInstallmentNumber(CONFIRM_CONTADO)).toBe(1)
  })
  it('confirm_plan paga la cuota 0 (inicial)', () => {
    expect(targetInstallmentNumber(CONFIRM_PLAN)).toBe(0)
  })
  it('otra accion no tiene cuota objetivo', () => {
    expect(targetInstallmentNumber('otra')).toBeNull()
    expect(targetInstallmentNumber(undefined)).toBeNull()
  })
})

describe('isIdempotencyEligible', () => {
  it('solo confirm_contado y confirm_plan participan del guard', () => {
    expect(isIdempotencyEligible(CONFIRM_CONTADO)).toBe(true)
    expect(isIdempotencyEligible(CONFIRM_PLAN)).toBe(true)
    expect(isIdempotencyEligible('refund')).toBe(false)
    expect(isIdempotencyEligible(null)).toBe(false)
  })
})

describe('isPaidStatusAlias', () => {
  it('reconoce ambos aliases de cuota pagada', () => {
    for (const alias of PAID_STATUS_ALIASES) {
      expect(isPaidStatusAlias(alias)).toBe(true)
    }
  })
  it('rechaza aliases no pagados o nulos', () => {
    expect(isPaidStatusAlias('we_inst_pending')).toBe(false)
    expect(isPaidStatusAlias(null)).toBe(false)
    expect(isPaidStatusAlias(undefined)).toBe(false)
  })
})

describe('isValidActivationDateFormat', () => {
  it('acepta YYYY-MM-DD', () => {
    expect(isValidActivationDateFormat('2026-06-15')).toBe(true)
    expect(isValidActivationDateFormat('  2026-06-15  ')).toBe(true)
  })
  it('rechaza otros formatos', () => {
    expect(isValidActivationDateFormat('15/06/2026')).toBe(false)
    expect(isValidActivationDateFormat('2026-6-1')).toBe(false)
    expect(isValidActivationDateFormat('hoy')).toBe(false)
  })
})

describe('resolveMembershipActivationDecision', () => {
  it('no aplica si el programa no es membresia', () => {
    expect(resolveMembershipActivationDecision({ isMembershipProgram: false }))
      .toEqual({ isMembership: false })
  })

  it('membresia sin fecha: activacion inmediata sin persistir fecha', () => {
    expect(resolveMembershipActivationDecision({ isMembershipProgram: true, rawDate: null }))
      .toEqual({ isMembership: true, deferred: false, activationDate: null })
  })

  it('membresia con fecha de formato invalido devuelve error', () => {
    expect(resolveMembershipActivationDecision({ isMembershipProgram: true, rawDate: '15-06-2026' }))
      .toEqual({ error: 'activation_date debe ser YYYY-MM-DD' })
  })

  it('membresia con fecha fuera de ventana devuelve error', () => {
    const decision = resolveMembershipActivationDecision({
      isMembershipProgram: true,
      rawDate: '2027-06-15',
      isTodayOrPast: false,
      outOfWindow: true,
      activationDate: '2027-06-15',
      runAt: 'x'
    })
    expect(decision).toEqual({
      error: `activation_date excede la ventana permitida (${MEMBERSHIP_ACTIVATION_WINDOW_MONTHS} meses)`
    })
  })

  it('membresia con fecha hoy o pasada: flujo sincrono', () => {
    const decision = resolveMembershipActivationDecision({
      isMembershipProgram: true,
      rawDate: '2026-05-29',
      isTodayOrPast: true,
      outOfWindow: false,
      activationDate: '2026-05-29',
      runAt: 'ignored'
    })
    expect(decision).toEqual({ isMembership: true, deferred: false, activationDate: '2026-05-29' })
  })

  it('membresia con fecha futura dentro de ventana: diferida con runAt', () => {
    const decision = resolveMembershipActivationDecision({
      isMembershipProgram: true,
      rawDate: '2026-08-01',
      isTodayOrPast: false,
      outOfWindow: false,
      activationDate: '2026-08-01',
      runAt: '2026-08-01T14:00:00.000Z'
    })
    expect(decision).toEqual({
      isMembership: true,
      deferred: true,
      activationDate: '2026-08-01',
      runAt: '2026-08-01T14:00:00.000Z'
    })
  })
})
