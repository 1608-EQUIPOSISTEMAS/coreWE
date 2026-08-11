import { describe, it, expect } from 'vitest'
import Ajv from 'ajv'
import { editionUpdateSchema } from '../../src/modules/edition/edition.schemas.js'

// El servidor valida con removeAdditional activo (default de @fastify/ajv-compiler,
// ver tests/smoke/http-wiring.test.js): un campo que el schema no declara NO
// devuelve 400, se BORRA del body y el guardado miente sin fallar. Asi se perdio
// whatsapp_link durante meses. Este test corre con las mismas opciones para que
// una columna nueva sin declarar rompa aca y no en produccion.
const validate = new Ajv({ removeAdditional: true, coerceTypes: true, useDefaults: true })
  .compile(editionUpdateSchema.body)

function bodyTras (edition) {
  const body = { id: 1, user_id: 1, edition }
  validate(body)
  return body.edition
}

describe('editionUpdateSchema', () => {
  it('deja pasar los cuatro links del aula', () => {
    const links = {
      whatsapp_link: 'https://chat.whatsapp.com/X',
      teams_link: 'https://teams.microsoft.com/X',
      ficha_link: 'https://drive.google.com/ficha',
      grades_link: 'https://docs.google.com/notas'
    }
    expect(bodyTras({ ...links })).toEqual(links)
  })

  it('acepta null para borrar un link', () => {
    expect(bodyTras({ ficha_link: null })).toEqual({ ficha_link: null })
  })

  it('descarta lo que no declara (documenta el borrado silencioso)', () => {
    expect(bodyTras({ campo_inventado: 'x' })).toEqual({})
  })
})
