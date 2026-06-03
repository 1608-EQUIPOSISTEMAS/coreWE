import { describe, it, expect } from 'vitest'
import { buildJwtPayload, validateCredentialsResult, requireRoleAlias } from '../auth.entity.js'
import { DomainError } from '../../../shared/errors.js'

describe('buildJwtPayload', () => {
  it('mapea el usuario crudo al payload del JWT', () => {
    const user = { user_id: 7, alias: 'jdoe', roles: ['ADMIN'], password_hash: 'x' }
    expect(buildJwtPayload(user)).toEqual({ id: 7, username: 'jdoe', roles: ['ADMIN'] })
  })
  it('tolera usuario vacio sin lanzar', () => {
    expect(buildJwtPayload()).toEqual({ id: undefined, username: undefined, roles: undefined })
  })
})

describe('validateCredentialsResult', () => {
  it('devuelve el usuario cuando existe', () => {
    const user = { user_id: 1 }
    expect(validateCredentialsResult(user)).toBe(user)
  })
  it('lanza DomainError 401 cuando no hay usuario', () => {
    expect(() => validateCredentialsResult(undefined)).toThrow(DomainError)
    try {
      validateCredentialsResult(null)
    } catch (err) {
      expect(err.statusCode).toBe(401)
      expect(err.message).toBe('Usuario o contraseña incorrectos')
    }
  })
})

describe('requireRoleAlias', () => {
  it('recorta espacios y devuelve el alias', () => {
    expect(requireRoleAlias('  FICO  ')).toBe('FICO')
  })
  it('lanza DomainError 400 cuando falta o esta vacio', () => {
    for (const value of [undefined, null, '', '   ']) {
      try {
        requireRoleAlias(value)
        throw new Error('no deberia llegar aqui')
      } catch (err) {
        expect(err).toBeInstanceOf(DomainError)
        expect(err.statusCode).toBe(400)
        expect(err.message).toBe('role_alias es obligatorio')
      }
    }
  })
})
