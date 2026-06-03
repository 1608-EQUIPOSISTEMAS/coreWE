import { describe, it, expect } from 'vitest'
import {
  countUnread,
  filterUnread,
  buildSseEventData,
  parseNotificationPayload,
  buildListFilters
} from '../notification.entity.js'

describe('countUnread', () => {
  it('cuenta solo los registros con is_read false', () => {
    expect(countUnread([{ is_read: false }, { is_read: true }, { is_read: false }])).toBe(2)
  })
  it('devuelve 0 con coleccion vacia o ausente', () => {
    expect(countUnread([])).toBe(0)
    expect(countUnread()).toBe(0)
  })
})

describe('filterUnread', () => {
  it('devuelve solo los no leidos', () => {
    const a = { id: 1, is_read: false }
    const b = { id: 2, is_read: true }
    expect(filterUnread([a, b])).toEqual([a])
  })
  it('devuelve arreglo vacio si no hay no leidos', () => {
    expect(filterUnread([{ is_read: true }])).toEqual([])
  })
})

describe('buildSseEventData', () => {
  it('serializa al formato data: ...\\n\\n', () => {
    expect(buildSseEventData({ a: 1 })).toBe('data: {"a":1}\n\n')
  })
})

describe('parseNotificationPayload', () => {
  it('parsea el JSON y castea asesor_id a numero', () => {
    const out = parseNotificationPayload('{"asesor_id":"42","tipo":"x"}')
    expect(out.asesor_id).toBe(42)
    expect(out.tipo).toBe('x')
  })
  it('conserva el resto de propiedades', () => {
    const out = parseNotificationPayload('{"asesor_id":7,"lead_id":9}')
    expect(out).toEqual({ asesor_id: 7, lead_id: 9 })
  })
})

describe('buildListFilters', () => {
  it('aplica defaults page=1 size=20', () => {
    expect(buildListFilters({ user_id: 5 })).toEqual({ user_id: 5, page: 1, size: 20, is_read: undefined })
  })
  it('fuerza page minimo 1', () => {
    expect(buildListFilters({ user_id: 5, page: 0 }).page).toBe(1)
    expect(buildListFilters({ user_id: 5, page: -3 }).page).toBe(1)
  })
  it('acota size al rango [1, 100]', () => {
    expect(buildListFilters({ user_id: 5, size: 500 }).size).toBe(100)
    expect(buildListFilters({ user_id: 5, size: 0 }).size).toBe(20)
  })
  it('propaga is_read', () => {
    expect(buildListFilters({ user_id: 5, is_read: true }).is_read).toBe(true)
  })
})
