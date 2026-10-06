import { describe, it, expect } from 'vitest'
import { childPersonalAccount, normalizePersonalAccount, studentPersonalAccount } from '../personal-account.js'

// La etiqueta = "usa su propia cuenta": Academica NO le entrega una en ese
// modulo. Si un hijo la hereda de mas, el alumno se queda sin cuenta pagada; si
// no la hereda, se le regala una.
const CHATGPT = { pvId: 246, name: 'CHATGPT' }
const CLAUDE = { pvId: 247, name: 'CLAUDE' }
const CLAUDE_AVANZ = { pvId: 253, name: 'CLAUDE AVANZ' }
const N8N = { pvId: 213, name: 'N8N:AGENTES IA' }

describe('childPersonalAccount', () => {
  it('S/200: sin lista de modulos, todos los modulos del proveedor la llevan', () => {
    const parent = { personal_account: 'CLAUDE', personal_account_modules: null }
    expect(childPersonalAccount(parent, CLAUDE)).toBe('CLAUDE')
    expect(childPersonalAccount(parent, CLAUDE_AVANZ)).toBe('CLAUDE')
  })

  it('S/100: solo el modulo elegido por la asesora', () => {
    const parent = { personal_account: 'CLAUDE', personal_account_modules: [253] }
    expect(childPersonalAccount(parent, CLAUDE)).toBeNull()
    expect(childPersonalAccount(parent, { ...CLAUDE_AVANZ, pvId: '253' })).toBe('CLAUDE')
  })

  it('Diplomado con los dos beneficios: cada modulo toma el proveedor de su nombre', () => {
    const parent = { personal_account: null, account_providers: ['CLAUDE', 'CHATGPT'] }
    expect(childPersonalAccount(parent, CHATGPT)).toBe('CHATGPT')
    expect(childPersonalAccount(parent, CLAUDE)).toBe('CLAUDE')
  })

  it('un modulo que no es de Claude ni ChatGPT nunca la lleva', () => {
    const parent = { personal_account: 'CLAUDE', account_providers: ['CLAUDE', 'CHATGPT'] }
    expect(childPersonalAccount(parent, N8N)).toBeNull()
  })

  it('solo el beneficio CLAUDE: el modulo ChatGPT no la lleva', () => {
    expect(childPersonalAccount({ personal_account: 'CLAUDE' }, CHATGPT)).toBeNull()
  })

  it('padre sin etiqueta ni beneficio: ningun hijo la lleva', () => {
    expect(childPersonalAccount({ personal_account: null, personal_account_modules: [247] }, CLAUDE)).toBeNull()
  })
})

describe('studentPersonalAccount (lista del aula)', () => {
  it('member por FICO directo: sin etiqueta guardada, sale del beneficio de la venta', () => {
    const row = { personal_account: null, sold_account_providers: ['CLAUDE', 'CHATGPT'] }
    expect(studentPersonalAccount({ ...row, module_name: 'CHATGPT: INVESTIGACION Y ANALISIS' })).toBe('CHATGPT')
    expect(studentPersonalAccount({ ...row, module_name: 'CLAUDE: REPORTES Y PRESENTACIONES' })).toBe('CLAUDE')
    expect(studentPersonalAccount({ ...row, module_name: 'N8N:AGENTES IA' })).toBeNull()
  })

  it('hijo viejo que heredo CLAUDE en todos los modulos: solo el modulo Claude la muestra', () => {
    const row = { personal_account: 'CLAUDE', sold_account_providers: ['CLAUDE'] }
    expect(studentPersonalAccount({ ...row, module_name: 'CLAUDE: REPORTES' })).toBe('CLAUDE')
    expect(studentPersonalAccount({ ...row, module_name: 'CHATGPT: INVESTIGACION' })).toBeNull()
    expect(studentPersonalAccount({ ...row, module_name: 'IA para la Productividad' })).toBeNull()
  })

  it('member sin beneficio ni etiqueta: Academica ve que no lleva cuenta propia', () => {
    expect(studentPersonalAccount({ personal_account: null, sold_account_providers: [], module_name: 'CLAUDE: REPORTES' })).toBeNull()
  })
})

describe('normalizePersonalAccount', () => {
  it('solo acepta los proveedores conocidos', () => {
    expect(normalizePersonalAccount('claude')).toBe('CLAUDE')
    expect(normalizePersonalAccount('GEMINI')).toBeNull()
    expect(normalizePersonalAccount('')).toBeNull()
  })
})
