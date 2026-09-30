import { describe, it, expect } from 'vitest'
import { childPersonalAccount, normalizePersonalAccount } from '../personal-account.js'

// Academica entrega una cuenta por cada modulo con etiqueta: si un hijo la
// hereda de mas, es una cuenta regalada; si no la hereda, un alumno sin cuenta.
describe('childPersonalAccount', () => {
  it('S/200: sin lista de modulos, todos los hijos llevan la cuenta', () => {
    const parent = { personal_account: 'CLAUDE', personal_account_modules: null }
    expect(childPersonalAccount(parent, 501)).toBe('CLAUDE')
    expect(childPersonalAccount(parent, 502)).toBe('CLAUDE')
  })

  it('S/100: solo el modulo elegido por la asesora', () => {
    const parent = { personal_account: 'CHATGPT', personal_account_modules: [502] }
    expect(childPersonalAccount(parent, 501)).toBeNull()
    expect(childPersonalAccount(parent, '502')).toBe('CHATGPT')
  })

  it('padre sin etiqueta: ningun hijo la lleva', () => {
    expect(childPersonalAccount({ personal_account: null, personal_account_modules: [501] }, 501)).toBeNull()
  })
})

describe('normalizePersonalAccount', () => {
  it('solo acepta los proveedores conocidos', () => {
    expect(normalizePersonalAccount('claude')).toBe('CLAUDE')
    expect(normalizePersonalAccount('GEMINI')).toBeNull()
    expect(normalizePersonalAccount('')).toBeNull()
  })
})
