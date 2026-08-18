import { describe, it, expect } from 'vitest'
import {
  ODOO_DEFAULT_PASSWORD,
  isE0Parent,
  resolveCurrencyCode,
  buildOdooFullName,
  buildPresentialCourseName,
  mapInstallmentsForOdoo
} from '../odoo-sync.entity.js'

describe('isE0Parent', () => {
  it('es E0 padre cuando no hay edicion y tiene hijos', () => {
    expect(isE0Parent({ programEditionId: null, childrenCount: 3 })).toBe(true)
  })

  it('no es E0 padre si tiene edicion programada', () => {
    expect(isE0Parent({ programEditionId: 99, childrenCount: 3 })).toBe(false)
  })

  it('no es E0 padre si no tiene hijos', () => {
    expect(isE0Parent({ programEditionId: null, childrenCount: 0 })).toBe(false)
  })

  it('trata undefined de edicion como ausente', () => {
    expect(isE0Parent({ programEditionId: undefined, childrenCount: 2 })).toBe(true)
  })
})

describe('resolveCurrencyCode', () => {
  it('mapea we_currency_usd a USD', () => {
    expect(resolveCurrencyCode('we_currency_usd')).toBe('USD')
  })

  it('cualquier otro alias cae a PEN', () => {
    expect(resolveCurrencyCode('we_currency_soles')).toBe('PEN')
    expect(resolveCurrencyCode(null)).toBe('PEN')
    expect(resolveCurrencyCode(undefined)).toBe('PEN')
  })
})

describe('buildOdooFullName', () => {
  it('formatea APELLIDO NOMBRE en mayusculas', () => {
    expect(buildOdooFullName({ firstName: 'Maria', lastName: 'Perez' })).toBe('PEREZ MARIA')
  })

  it('recorta espacios sobrantes', () => {
    expect(buildOdooFullName({ firstName: '  Ana ', lastName: ' Lopez ' })).toBe('LOPEZ ANA')
  })

  it('incluye el apellido materno cuando existe', () => {
    expect(buildOdooFullName({ firstName: 'Bianca', lastName: 'Cueva', motherLastName: 'Vargas' }))
      .toBe('CUEVA VARGAS BIANCA')
  })

  it('tolera nombre o apellido vacio', () => {
    expect(buildOdooFullName({ firstName: 'Juan', lastName: '' })).toBe('JUAN')
    expect(buildOdooFullName({ firstName: '', lastName: 'Diaz' })).toBe('DIAZ')
  })
})

describe('buildPresentialCourseName', () => {
  it('construye el nombre con dia/mes y mes/anio en UTC', () => {
    const name = buildPresentialCourseName({
      odooActivation: 'CURSO X',
      startDate: '2026-03-09T00:00:00.000Z'
    })
    expect(name).toBe('CURSO X (09/03) - Marzo 2026')
  })

  it('acepta objeto Date', () => {
    const name = buildPresentialCourseName({
      odooActivation: 'DIPLOMADO',
      startDate: new Date('2026-12-01T00:00:00.000Z')
    })
    expect(name).toBe('DIPLOMADO (01/12) - Diciembre 2026')
  })
})

describe('mapInstallmentsForOdoo', () => {
  it('devuelve null cuando no hay cuotas', () => {
    expect(mapInstallmentsForOdoo([])).toBeNull()
    expect(mapInstallmentsForOdoo(null)).toBeNull()
  })

  it('mapea monto numerico y fecha YYYY-MM-DD', () => {
    const out = mapInstallmentsForOdoo([
      { amount: '100.50', due_date: '2026-04-15T05:00:00.000Z' },
      { amount: 200, due_date: null }
    ])
    expect(out).toEqual([
      { amount: 100.5, due_date: '2026-04-15' },
      { amount: 200, due_date: null }
    ])
  })
})

describe('ODOO_DEFAULT_PASSWORD', () => {
  it('es el password fijo del usuario Odoo', () => {
    expect(ODOO_DEFAULT_PASSWORD).toBe('1234567')
  })
})
