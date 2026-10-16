import { describe, it, expect } from 'vitest'
import { expiryStatus, isRenewal, buildMembershipExpiries } from '../membership.entity.js'

const m = (person_id, start_date, expiry_date, tier = 'PLUS') => ({ person_id, start_date, expiry_date, tier })

describe('expiryStatus (aviso un mes antes)', () => {
  it('a mas de 30 dias esta vigente', () => expect(expiryStatus(31)).toBe('active'))
  it('a 30 dias o menos esta por vencer', () => {
    expect(expiryStatus(30)).toBe('expiring')
    expect(expiryStatus(0)).toBe('expiring')
  })
  it('pasada la fecha esta vencida', () => expect(expiryStatus(-1)).toBe('expired'))
})

describe('isRenewal', () => {
  const prev = m(1, '2025-11-17', '2026-11-17')
  it('comprada dentro del mes de aviso renueva', () => expect(isRenewal(prev, m(1, '2026-10-20', '2027-10-20'))).toBe(true))
  it('comprada despues de vencer renueva', () => expect(isRenewal(prev, m(1, '2026-12-01', '2027-12-01'))).toBe(true))
  it('PLUS → BLACK a mitad de año es cambio de tier, no renovacion', () => {
    expect(isRenewal(prev, m(1, '2026-03-01', '2027-03-01', 'BLACK'))).toBe(false)
  })
})

describe('buildMembershipExpiries', () => {
  const rows = [
    m(1, '2025-11-17', '2026-11-17'),
    m(1, '2026-11-20', '2027-11-20', 'BLACK'),
    m(2, '2025-10-01', '2026-10-01'),
    m(3, '2025-11-01', '2026-11-01')
  ]
  const { items, kpis } = buildMembershipExpiries(rows, '2026-10-15')

  it('una fila por socio con su membresia mas reciente', () => {
    expect(items).toHaveLength(3)
    expect(items.find(i => i.person_id === 1)).toMatchObject({ tier: 'BLACK', renewals: 1, status: 'active' })
  })
  it('cuenta dias y estado contra el hoy de Lima', () => {
    expect(items.find(i => i.person_id === 2)).toMatchObject({ days_to_expiry: -14, status: 'expired' })
    expect(items.find(i => i.person_id === 3)).toMatchObject({ days_to_expiry: 17, status: 'expiring' })
  })
  it('ordena por vencimiento y totaliza', () => {
    expect(items.map(i => i.person_id)).toEqual([2, 3, 1])
    expect(kpis).toEqual({ total: 3, active: 1, expiring: 1, expired: 1, renewed: 1 })
  })
})
