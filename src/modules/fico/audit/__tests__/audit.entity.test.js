import { describe, it, expect } from 'vitest'
import { DomainError } from '../../../../shared/errors.js'
import {
  CANONICAL_ACTIONS,
  isCanonicalAction,
  normalizeAuditEntry
} from '../audit.entity.js'

describe('isCanonicalAction', () => {
  it('reconoce las acciones canonicas', () => {
    expect(isCanonicalAction('created')).toBe(true)
    expect(isCanonicalAction('email_failed')).toBe(true)
    expect(isCanonicalAction('seller_agent_changed')).toBe(true)
  })
  it('rechaza acciones desconocidas o con typo', () => {
    expect(isCanonicalAction('aproved')).toBe(false)
    expect(isCanonicalAction('')).toBe(false)
    expect(isCanonicalAction(undefined)).toBe(false)
  })
  it('la lista canonica es inmutable', () => {
    expect(Object.isFrozen(CANONICAL_ACTIONS)).toBe(true)
  })
})

describe('normalizeAuditEntry', () => {
  it('serializa changes a JSON y rellena opcionales con null', () => {
    const out = normalizeAuditEntry({
      enrollmentId: 10,
      action: 'edited',
      changes: { a: 1 }
    })
    expect(out).toEqual({
      enrollmentId: 10,
      action: 'edited',
      userId: null,
      justificacion: null,
      changesJson: JSON.stringify({ a: 1 }),
      details: null
    })
  })

  it('conserva userId, justificacion y details cuando vienen', () => {
    const out = normalizeAuditEntry({
      enrollmentId: 5,
      action: 'observed',
      userId: 7,
      justificacion: 'falta voucher',
      details: 'detalle libre'
    })
    expect(out.userId).toBe(7)
    expect(out.justificacion).toBe('falta voucher')
    expect(out.details).toBe('detalle libre')
    expect(out.changesJson).toBeNull()
  })

  it('hace trim al action', () => {
    expect(normalizeAuditEntry({ enrollmentId: 1, action: '  approved  ' }).action).toBe('approved')
  })

  it('acepta enrollmentId = 0 (id valido) sin lanzar', () => {
    expect(() => normalizeAuditEntry({ enrollmentId: 0, action: 'created' })).not.toThrow()
  })

  it('exige enrollmentId', () => {
    expect(() => normalizeAuditEntry({ action: 'created' })).toThrow(DomainError)
    expect(() => normalizeAuditEntry({ enrollmentId: null, action: 'created' })).toThrow(DomainError)
  })

  it('exige action no vacia', () => {
    expect(() => normalizeAuditEntry({ enrollmentId: 1 })).toThrow(DomainError)
    expect(() => normalizeAuditEntry({ enrollmentId: 1, action: '   ' })).toThrow(DomainError)
  })
})
