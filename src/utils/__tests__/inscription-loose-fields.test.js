import { describe, it, expect } from 'vitest'
import { saveLooseInscriptionFields } from '../inscription-loose-fields.js'

// El UPDATE se arma a mano con indices de parametro ($1, $2...). Si el orden de
// los SET y el de params se desincroniza, el CC termina escrito en la columna
// equivocada sin que nadie se entere. Esto es lo que cubre el test.
function fakeDb () {
  const calls = []
  return { calls, query: async (text, params) => { calls.push({ text, params }) } }
}

describe('saveLooseInscriptionFields', () => {
  it('no toca la BD cuando no hay ningun campo suelto', async () => {
    const db = fakeDb()
    await saveLooseInscriptionFields(db, 100, {})
    expect(db.calls).toHaveLength(0)
  })

  it('escribe cada valor en su columna con el indice correcto', async () => {
    const db = fakeDb()
    await saveLooseInscriptionFields(db, 777, {
      cat_event_category: 42,
      email_cc: 'jefe@empresa.com, rrhh@empresa.com',
      requires_email_cc: true
    })

    expect(db.calls).toHaveLength(1)
    const { text, params } = db.calls[0]
    expect(text).toContain('cat_event_category = $1')
    expect(text).toContain('email_cc = $2')
    expect(text).toContain('requires_email_cc = true')
    expect(text).toContain('WHERE enrollment_id = $3')
    expect(params).toEqual([42, 'jefe@empresa.com,rrhh@empresa.com', 777])
  })

  // El asiento VIP se guarda tal cual, solo sin el espacio sobrante.
  it('recorta el asiento y lo escribe en su columna', async () => {
    const db = fakeDb()
    await saveLooseInscriptionFields(db, 5, { event_seat: '  A-12  ' })
    expect(db.calls[0].text).toContain('event_seat = $1')
    expect(db.calls[0].params).toEqual(['A-12', 5])
  })

  it('un asiento en blanco no genera UPDATE', async () => {
    const db = fakeDb()
    await saveLooseInscriptionFields(db, 5, { event_seat: '   ' })
    expect(db.calls).toHaveLength(0)
  })

  it('el enrollment_id sigue al final cuando solo viaja un campo', async () => {
    const db = fakeDb()
    await saveLooseInscriptionFields(db, 55, { email_cc: 'a@b.com' })
    expect(db.calls[0].text).toContain('email_cc = $1')
    expect(db.calls[0].params).toEqual(['a@b.com', 55])
  })

  it('descarta correos con formato invalido y no escribe email_cc si no queda ninguno', async () => {
    const db = fakeDb()
    await saveLooseInscriptionFields(db, 9, { email_cc: 'sin-arroba, otro-malo' })
    expect(db.calls).toHaveLength(0)
  })

  it('nunca baja el flag: requires_email_cc false no genera UPDATE', async () => {
    const db = fakeDb()
    await saveLooseInscriptionFields(db, 9, { requires_email_cc: false })
    expect(db.calls).toHaveLength(0)
  })

  it('no propaga el error de BD: la venta ya quedo registrada', async () => {
    const db = { query: async () => { throw new Error('socket muerto') } }
    await expect(saveLooseInscriptionFields(db, 1, { email_cc: 'a@b.com' })).resolves.toBeUndefined()
  })
})
