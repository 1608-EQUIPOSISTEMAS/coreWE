import { describe, it, expect } from 'vitest'
import { buildMembershipExpiries } from '../../fico/membership/membership.entity.js'
import { academicStage, currentMembers } from '../academica-membresias.entity.js'

const m = (person_id, start_date, expiry_date) => ({ person_id, start_date, expiry_date, tier: 'PLUS' })

describe('academicStage', () => {
  it('los primeros 7 dias (0..6) son de bienvenida', () => {
    expect(academicStage({ daysSinceStart: 0, daysToExpiry: 365 })).toBe('welcome')
    expect(academicStage({ daysSinceStart: 6, daysToExpiry: 359 })).toBe('welcome')
  })
  it('desde el dia 7 pasa a seguimiento', () => {
    expect(academicStage({ daysSinceStart: 7, daysToExpiry: 358 })).toBe('followup')
    expect(academicStage({ daysSinceStart: 300, daysToExpiry: 11 })).toBe('followup')
  })
  it('a 10 dias o menos de vencer esta por vencer, hasta el mismo dia', () => {
    expect(academicStage({ daysSinceStart: 355, daysToExpiry: 10 })).toBe('expiring')
    expect(academicStage({ daysSinceStart: 365, daysToExpiry: 0 })).toBe('expiring')
  })
})

describe('currentMembers (Academica)', () => {
  // Hoy 2026-10-23, arranque = fecha de registro + 12 meses.
  const rows = [
    m(1, '2025-10-22', '2026-10-22'), // vencio ayer
    m(2, '2025-11-01', '2026-11-01'), // por vencer (9 d)
    m(3, '2026-03-01', '2027-03-01'), // seguimiento
    m(4, '2026-10-20', '2027-10-20'), // bienvenida (dia 3)
    m(5, '2025-10-23', '2026-10-23') // vence hoy: todavia tiene beneficio
  ]
  const { items, kpis } = currentMembers(buildMembershipExpiries(rows, '2026-10-23'))

  it('no lista a los socios con membresia vencida', () => {
    expect(items.map(i => i.person_id)).toEqual([5, 2, 3, 4])
  })
  it('la etapa sale de la fecha de registro y del hoy', () => {
    const stage = Object.fromEntries(items.map(i => [i.person_id, i.status]))
    expect(stage).toEqual({ 2: 'expiring', 3: 'followup', 4: 'welcome', 5: 'expiring' })
  })
  it('los KPIs cuentan por etapa y no incluyen vencidas', () => {
    expect(kpis).toEqual({ total: 4, welcome: 1, followup: 1, expiring: 2, renewed: 0 })
  })
})
