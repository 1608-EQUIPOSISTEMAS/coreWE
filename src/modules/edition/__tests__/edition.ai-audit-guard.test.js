import { describe, it, expect } from 'vitest'
import { aiAuditBlockReason, aiAuditCostUsd, aiMonthlySpend } from '../edition.entity.js'

describe('aiAuditBlockReason (no pagar dos veces la misma auditoria IA)', () => {
  it('bloquea si la sesion ya se esta analizando', () => {
    expect(aiAuditBlockReason({ running: true, existingReport: null })).toMatch(/ya se esta analizando/)
  })
  it('bloquea si ya hay reporte guardado', () => {
    expect(aiAuditBlockReason({ running: false, existingReport: { resumen: 'x' } })).toMatch(/ya tiene analisis/)
  })
  it('deja correr una sesion sin reporte ni corrida en curso', () => {
    expect(aiAuditBlockReason({ running: false, existingReport: null })).toBeNull()
  })
})

describe('gasto mensual de auditoria IA (informativo, sin tope)', () => {
  const v2 = (usd) => ({ cost_version: 2, estimated_cost_usd: usd })
  it('filas nuevas al costo real; viejas al costo tipico medido', () => {
    expect(aiAuditCostUsd(v2(0.42))).toBe(0.42)
    expect(aiAuditCostUsd({ estimated_cost_usd: 0.13 })).toBe(0.5)
    expect(aiAuditCostUsd(null)).toBe(0)
  })
  it('suma el mes en soles', () => {
    expect(aiMonthlySpend([v2(10), v2(20)], { usdToPen: 4 })).toEqual({ audits: 2, spentPen: 120 })
  })
})
