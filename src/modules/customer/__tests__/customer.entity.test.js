import { describe, it, expect } from 'vitest'
import {
  normalizeActive,
  buildDisplayName,
  detectDocumentType,
  mapSunatResponse,
  buildListResult
} from '../customer.entity.js'

describe('normalizeActive', () => {
  it('mapea booleanos a Y/N', () => {
    expect(normalizeActive(true)).toBe('Y')
    expect(normalizeActive(false)).toBe('N')
  })
  it('deja pasar strings tal cual y null en el resto', () => {
    expect(normalizeActive('Y')).toBe('Y')
    expect(normalizeActive('')).toBe('')
    expect(normalizeActive(null)).toBeNull()
    expect(normalizeActive(undefined)).toBeNull()
  })
})

describe('buildDisplayName', () => {
  it('prioriza la razon social cuando existe', () => {
    expect(buildDisplayName({ first_name: 'Ana', razon_social: 'Acme SAC' })).toBe('Acme SAC')
  })
  it('compone el nombre de persona si no hay razon social', () => {
    expect(buildDisplayName({ first_name: 'Ana', last_name: 'Diaz', mother_last_name: 'Ruiz' })).toBe('Ana Diaz Ruiz')
  })
  it('omite componentes vacios y nulos', () => {
    expect(buildDisplayName({ first_name: 'Ana', last_name: null, mother_last_name: '' })).toBe('Ana')
    expect(buildDisplayName({})).toBe('')
    expect(buildDisplayName({ razon_social: '   ' })).toBe('')
  })
})

describe('detectDocumentType', () => {
  it('identifica RUC por longitud 11', () => {
    expect(detectDocumentType('20123456789')).toBe('RUC')
  })
  it('identifica DNI para cualquier otra longitud', () => {
    expect(detectDocumentType('12345678')).toBe('DNI')
    expect(detectDocumentType('')).toBe('DNI')
  })
})

describe('mapSunatResponse', () => {
  it('mapea una respuesta de RUC', () => {
    const out = mapSunatResponse({ ruc: '20123456789', nombre_o_razon_social: 'Acme SAC' })
    expect(out).toEqual({
      document_type: 'RUC',
      document_number: '20123456789',
      nombre_o_razon_social: 'Acme SAC'
    })
  })
  it('mapea una respuesta de DNI', () => {
    const out = mapSunatResponse({ dni: '12345678', nombre_completo: 'Ana Diaz Ruiz' })
    expect(out).toEqual({
      document_type: 'DNI',
      document_number: '12345678',
      nombre_o_razon_social: 'Ana Diaz Ruiz'
    })
  })
  it('lanza si no reconoce el tipo de documento', () => {
    expect(() => mapSunatResponse({})).toThrow('Tipo de documento no reconocido en la respuesta de la API.')
  })
})

describe('buildListResult', () => {
  it('lee total_count de la primera fila y mapea items', () => {
    const rows = [
      {
        total_count: '3',
        id: 1,
        display_name: 'Acme SAC',
        document_number: '20123456789',
        person_id: null,
        company_id: 7,
        razon_social: 'Acme SAC',
        cat_customer_segment: 10,
        cat_customer_segment_label: 'Corporativo',
        cat_customer_status: 1,
        cat_customer_status_label: 'Activo',
        customer_active: 'Y',
        registration_date: '2026-05-01'
      }
    ]
    const out = buildListResult({ rows, page: 1, size: 25 })
    expect(out.total).toBe(3)
    expect(out.page).toBe(1)
    expect(out.size).toBe(25)
    expect(out.items).toHaveLength(1)
    expect(out.items[0]).toMatchObject({
      customer_id: 1,
      display_name: 'Acme SAC',
      company_id: 7,
      active: 'Y'
    })
  })
  it('devuelve total 0 y lista vacia sin filas', () => {
    expect(buildListResult({ rows: [], page: 2, size: 10 })).toEqual({ total: 0, page: 2, size: 10, items: [] })
    expect(buildListResult({})).toEqual({ total: 0, page: 1, size: 25, items: [] })
  })
})
