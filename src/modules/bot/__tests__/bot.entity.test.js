import { describe, it, expect } from 'vitest'
import {
  buildDashboardFilters,
  resolveResolvedBy,
  buildTicketUpdatePayload
} from '../bot.entity.js'

describe('buildDashboardFilters', () => {
  it('conserva las fechas presentes', () => {
    expect(buildDashboardFilters({ from_date: '2026-01-01', to_date: '2026-01-31' }))
      .toEqual({ from_date: '2026-01-01', to_date: '2026-01-31' })
  })
  it('coerciona ausencias y vacios a null', () => {
    expect(buildDashboardFilters({})).toEqual({ from_date: null, to_date: null })
    expect(buildDashboardFilters({ from_date: '', to_date: '' })).toEqual({ from_date: null, to_date: null })
    expect(buildDashboardFilters()).toEqual({ from_date: null, to_date: null })
  })
})

describe('resolveResolvedBy', () => {
  it('prioriza el usuario logueado', () => {
    expect(resolveResolvedBy({ current_user_id: 7, user_id: 99 })).toBe(7)
  })
  it('cae al user_id del cuerpo', () => {
    expect(resolveResolvedBy({ current_user_id: null, user_id: 99 })).toBe(99)
    expect(resolveResolvedBy({ user_id: 99 })).toBe(99)
  })
  it('devuelve null sin ninguno', () => {
    expect(resolveResolvedBy({})).toBeNull()
    expect(resolveResolvedBy()).toBeNull()
  })
})

describe('buildTicketUpdatePayload', () => {
  it('arma el payload con resolved_by resuelto', () => {
    expect(buildTicketUpdatePayload({
      status: 'closed',
      notes: 'ok',
      assigned_to: 3,
      current_user_id: 7,
      user_id: 99
    })).toEqual({
      status: 'closed',
      notes: 'ok',
      assigned_to: 3,
      resolved_by: 7
    })
  })
  it('coerciona assigned_to ausente a null y cae al user_id', () => {
    expect(buildTicketUpdatePayload({ status: 'open', notes: null, user_id: 5 })).toEqual({
      status: 'open',
      notes: null,
      assigned_to: null,
      resolved_by: 5
    })
  })
})
