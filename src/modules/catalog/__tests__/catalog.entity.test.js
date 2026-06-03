import { describe, it, expect } from 'vitest'
import { buildMembershipParams } from '../catalog.entity.js'

describe('buildMembershipParams', () => {
  it('mapea en el orden exacto del SP con defaults', () => {
    expect(buildMembershipParams({})).toEqual([null, null, 1, 25])
  })
  it('pasa active crudo (boolean o null), no Y/N', () => {
    expect(buildMembershipParams({ active: true })).toEqual([true, null, 1, 25])
    expect(buildMembershipParams({ active: false })).toEqual([false, null, 1, 25])
    expect(buildMembershipParams({ active: null })).toEqual([null, null, 1, 25])
  })
  it('convierte q vacio en null y respeta page/size', () => {
    expect(buildMembershipParams({ q: '', page: 3, size: 50 })).toEqual([null, null, 3, 50])
    expect(buildMembershipParams({ q: 'pro', page: 2, size: 10 })).toEqual([null, 'pro', 2, 10])
  })
  it('no capa size (paridad con legacy sin limite superior)', () => {
    expect(buildMembershipParams({ size: 1000 })).toEqual([null, null, 1, 1000])
  })
})
