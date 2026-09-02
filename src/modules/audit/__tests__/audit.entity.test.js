import { describe, it, expect } from 'vitest'
import { auditableRolesFor, normalizeFilters, AUDITED_TABLES } from '../audit.entity.js'

describe('auditableRolesFor', () => {
  it('ADMIN audita todo: sin filtro de rol', () => {
    expect(auditableRolesFor(['ADMIN'])).toBeNull()
  })

  it('un líder solo audita su área', () => {
    expect(auditableRolesFor(['LIDER_COMERCIAL'])).toEqual(['COMERCIAL', 'LIDER_COMERCIAL'])
  })

  it('un líder con dos áreas las ve ambas, sin repetir', () => {
    expect(auditableRolesFor(['LIDER_B2B', 'LIDER_COMERCIAL', 'COMERCIAL']).sort())
      .toEqual(['B2B', 'COMERCIAL', 'LIDER_B2B', 'LIDER_COMERCIAL'])
  })

  it('un rol operativo no entra a la auditoría', () => {
    expect(() => auditableRolesFor(['COMERCIAL'])).toThrow(/solo para ADMIN/)
    expect(() => auditableRolesFor(['GERENCIA'])).toThrow()
    expect(() => auditableRolesFor([])).toThrow()
  })

  it('el 403 no depende del orden de los roles', () => {
    expect(auditableRolesFor(['FICO', 'LIDER_FICO'])).toEqual(['FICO', 'LIDER_FICO'])
  })
})

describe('normalizeFilters', () => {
  it('descarta tablas y acciones fuera del catálogo', () => {
    const f = normalizeFilters({ table_name: 'users', action: 'TRUNCATE' })
    expect(f.tableName).toBeNull()
    expect(f.action).toBeNull()
  })

  it('acepta lo que sí está auditado', () => {
    const f = normalizeFilters({ table_name: 'payments', action: 'UPDATE' })
    expect(f).toMatchObject({ tableName: 'payments', action: 'UPDATE' })
  })

  // Las dos que nadie recuerda: no tienen trigger, las inserta el codigo a
  // mano, y por eso es facil que se caigan del catalogo en un refactor. Sin
  // ellas la vista las muestra con el nombre crudo de la tabla y no se pueden
  // filtrar.
  it('el catalogo incluye las bitacoras escritas a mano', () => {
    expect(AUDITED_TABLES).toHaveProperty('logins')
    expect(AUDITED_TABLES).toHaveProperty('edition_session_control')
    expect(normalizeFilters({ table_name: 'edition_session_control' }).tableName)
      .toBe('edition_session_control')
  })

  it('pagina desde 1 y acota el tamaño de página', () => {
    expect(normalizeFilters({})).toMatchObject({ limit: 50, offset: 0 })
    expect(normalizeFilters({ page: 3, page_size: 20 })).toMatchObject({ limit: 20, offset: 40 })
    expect(normalizeFilters({ page: 0, page_size: 9999 })).toMatchObject({ limit: 200, offset: 0 })
  })
})
