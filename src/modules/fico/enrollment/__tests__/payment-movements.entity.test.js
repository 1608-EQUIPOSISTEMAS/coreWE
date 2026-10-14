import { describe, it, expect } from 'vitest'
import { DomainError } from '../../../../shared/errors.js'
import { paymentMovementType, movementBusinessLine, assertMovementRange } from '../enrollment.entity.js'

describe('paymentMovementType', () => {
  it('el primer pago es PT si la venta es al contado y PP si abre cuotas', () => {
    expect(paymentMovementType({ paymentTypeAlias: 'we_payment_type_single', isFirstPayment: true })).toBe('PT')
    expect(paymentMovementType({ paymentTypeAlias: 'we_payment_type_initial', isFirstPayment: true })).toBe('PP')
  })

  it('un pago posterior es CUOTA aunque el catalogo diga "Pago Unico"', () => {
    // Asi vienen las cuotas 2..9 en los datos reales.
    expect(paymentMovementType({ paymentTypeAlias: 'we_payment_type_single', isFirstPayment: false })).toBe('CUOTA')
    expect(paymentMovementType({ paymentTypeAlias: 'we_payment_type_installment', isFirstPayment: false })).toBe('CUOTA')
  })

  it('certificado, reasignacion y diferencia de CC son ADICIONAL', () => {
    expect(paymentMovementType({ paymentTypeAlias: 'we_payment_type_certificate', isFirstPayment: false })).toBe('ADICIONAL')
    expect(paymentMovementType({ paymentTypeAlias: 'we_payment_type_reassignment', isFirstPayment: false })).toBe('ADICIONAL')
    expect(paymentMovementType({ paymentTypeAlias: 'we_payment_type_course_change_diff', isFirstPayment: false })).toBe('ADICIONAL')
  })
})

describe('movementBusinessLine', () => {
  it('una venta por convenio cuenta en B2B aunque el programa sea EN VIVO', () => {
    expect(movementBusinessLine({ agentOrigin: 'B2B', programLine: 'EN VIVO' })).toBe('B2B')
  })

  it('el resto usa la linea del programa en mayusculas', () => {
    expect(movementBusinessLine({ agentOrigin: 'WEB', programLine: 'Online' })).toBe('ONLINE')
    expect(movementBusinessLine({ agentOrigin: null, programLine: null })).toBe('')
  })
})

describe('assertMovementRange', () => {
  it('acepta un dia o un rango ordenado', () => {
    expect(() => assertMovementRange({ from: '2026-10-13', to: '2026-10-13' })).not.toThrow()
    expect(() => assertMovementRange({ from: '2026-10-01', to: '2026-10-13' })).not.toThrow()
  })

  it('rechaza fechas faltantes, mal formadas o invertidas', () => {
    expect(() => assertMovementRange({ from: '2026-10-13' })).toThrow(DomainError)
    expect(() => assertMovementRange({ from: '13/10/2026', to: '13/10/2026' })).toThrow(DomainError)
    expect(() => assertMovementRange({ from: '2026-10-14', to: '2026-10-13' })).toThrow(DomainError)
  })
})
