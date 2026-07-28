import { describe, it, expect } from 'vitest'
import { isEventEnrollment } from '../../src/shared/event-category.js'

// Este predicado decide si una inscripcion se salta Odoo por completo. Un falso
// positivo deja a un alumno de curso sin usuario en el campus, asi que el
// default ante cualquier duda tiene que ser false.

const dbReturning = rows => ({ query: async () => ({ rows }) })
const dbThrowing = () => ({ query: async () => { throw new Error('column does not exist') } })

describe('isEventEnrollment', () => {
  it('es evento cuando la consulta lo confirma', async () => {
    expect(await isEventEnrollment(14607, dbReturning([{ is_event: true }]))).toBe(true)
  })

  it('no es evento cuando la consulta lo niega', async () => {
    expect(await isEventEnrollment(14607, dbReturning([{ is_event: false }]))).toBe(false)
  })

  it('una inscripcion inexistente no es evento', async () => {
    expect(await isEventEnrollment(999999, dbReturning([]))).toBe(false)
  })

  // Ante un fallo de BD hay que seguir el camino normal: crear un alumno de mas
  // en Odoo se arregla, no crearlo deja la inscripcion rota sin aviso.
  it('ante un error de BD asume que NO es evento', async () => {
    expect(await isEventEnrollment(14607, dbThrowing())).toBe(false)
  })

  it('ignora ids invalidos sin tocar la BD', async () => {
    const db = { query: async () => { throw new Error('no deberia consultarse') } }
    expect(await isEventEnrollment(null, db)).toBe(false)
    expect(await isEventEnrollment('abc', db)).toBe(false)
  })
})
