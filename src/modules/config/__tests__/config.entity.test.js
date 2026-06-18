import { describe, it, expect } from 'vitest'
import {
  requireId,
  normalizeRoleAlias,
  validateRoleInput,
  validateRoleUpdate,
  forbidSuperRole,
  normalizePhones,
  normalizeRoleIds,
  validateUserInput
} from '../config.entity.js'
import { DomainError } from '../../../shared/errors.js'

describe('requireId', () => {
  it('acepta enteros positivos (incluso como string numérico)', () => {
    expect(requireId(5)).toBe(5)
    expect(requireId('12')).toBe(12)
  })
  it('rechaza cero, negativos, decimales y vacíos', () => {
    for (const bad of [0, -1, 1.5, null, undefined, 'abc']) {
      expect(() => requireId(bad)).toThrow(DomainError)
    }
  })
})

describe('normalizeRoleAlias', () => {
  it('normaliza a mayúsculas y reemplaza espacios por _', () => {
    expect(normalizeRoleAlias('  lider ventas ')).toBe('LIDER_VENTAS')
  })
  it('rechaza alias vacío o con caracteres inválidos', () => {
    expect(() => normalizeRoleAlias('')).toThrow(DomainError)
    expect(() => normalizeRoleAlias('ñoño!')).toThrow(DomainError)
    expect(() => normalizeRoleAlias('A')).toThrow(DomainError)
  })
})

describe('validateRoleInput / validateRoleUpdate', () => {
  it('exige descripción y alias', () => {
    expect(validateRoleInput({ description: ' Ventas ', alias: 'ventas' }))
      .toEqual({ description: 'Ventas', alias: 'VENTAS' })
    expect(() => validateRoleInput({ description: '', alias: 'X2' })).toThrow(DomainError)
  })
  it('update solo permite descripción con rol_id válido', () => {
    expect(validateRoleUpdate({ rol_id: 3, description: 'Nuevo nombre' }))
      .toEqual({ rolId: 3, description: 'Nuevo nombre' })
    expect(() => validateRoleUpdate({ rol_id: 3, description: ' ' })).toThrow(DomainError)
  })
})

describe('forbidSuperRole', () => {
  it('bloquea acciones sobre ADMIN y permite el resto', () => {
    expect(() => forbidSuperRole('ADMIN', 'modificar')).toThrow(DomainError)
    expect(() => forbidSuperRole('COMERCIAL', 'modificar')).not.toThrow()
  })
})

describe('normalizePhones', () => {
  it('limpia formato, deduplica y descarta vacíos', () => {
    expect(normalizePhones(['999-606-366', '999606366', '', null]))
      .toEqual(['999606366'])
  })
  it('rechaza teléfonos fuera de rango y tipos no lista', () => {
    expect(() => normalizePhones(['123'])).toThrow(DomainError)
    expect(() => normalizePhones('999606366')).toThrow(DomainError)
  })
  it('null equivale a lista vacía', () => {
    expect(normalizePhones(null)).toEqual([])
  })
})

describe('normalizeRoleIds', () => {
  it('deduplica y valida enteros', () => {
    expect(normalizeRoleIds([3, 3, 5])).toEqual([3, 5])
    expect(() => normalizeRoleIds([0])).toThrow(DomainError)
  })
})

describe('validateUserInput', () => {
  const base = {
    alias: ' ae30 ',
    first_name: ' Arleth ',
    last_name: 'Espinoza',
    email: 'ae30@we.com',
    password: 'secreto1',
    telefonos: ['999 606 366'],
    roles: [3]
  }

  it('normaliza alias a mayúsculas y teléfonos a dígitos', () => {
    const u = validateUserInput(base, { isNew: true })
    expect(u.alias).toBe('AE30')
    expect(u.firstName).toBe('Arleth')
    expect(u.phones).toEqual(['999606366'])
    expect(u.roleIds).toEqual([3])
    expect(u.active).toBe('Y')
  })

  it('exige contraseña solo al crear', () => {
    expect(() => validateUserInput({ ...base, password: null }, { isNew: true })).toThrow(DomainError)
    const u = validateUserInput({ ...base, password: null }, { isNew: false })
    expect(u.password).toBeNull()
  })

  it('rechaza contraseña corta también al actualizar', () => {
    expect(() => validateUserInput({ ...base, password: '123' }, { isNew: false })).toThrow(DomainError)
  })

  it('active solo acepta N como desactivación explícita', () => {
    expect(validateUserInput({ ...base, active: 'N' }, { isNew: true }).active).toBe('N')
    expect(validateUserInput({ ...base, active: undefined }, { isNew: true }).active).toBe('Y')
  })
})
