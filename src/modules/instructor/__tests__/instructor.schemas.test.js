import { describe, it, expect } from 'vitest'
import Ajv from 'ajv'
import { instructorUpdateSchema } from '../instructor.schemas.js'

// El servidor valida con removeAdditional (default de @fastify/ajv-compiler):
// un campo que el schema no declara NO devuelve 400, se BORRA del body y el
// guardado miente sin fallar. Se compila con las mismas opciones para que un
// campo nuevo sin declarar rompa aca y no en produccion.
const validate = new Ajv({ removeAdditional: true, coerceTypes: true, useDefaults: true })
  .compile(instructorUpdateSchema.body)

function instructorTras (instructor) {
  const body = { id: 1, instructor }
  validate(body)
  return body.instructor
}

describe('instructorUpdateSchema', () => {
  it('deja pasar usuario y contraseña de Odoo y Teams', () => {
    const accesos = {
      odoo_username: 'a.villegas',
      odoo_password: 'clave-odoo',
      teams_username: 'a.villegas@weeducacion.com',
      teams_password: 'clave-teams'
    }
    expect(instructorTras({ ...accesos })).toEqual(accesos)
  })

  it('deja pasar una lista de carpetas de clase de cualquier largo', () => {
    const folders = Array.from({ length: 10 }, (_, i) => ({
      label: `Clase ${i + 1}`,
      folder_url: `https://drive/c${i + 1}`
    }))
    expect(instructorTras({ class_folders: folders }).class_folders).toHaveLength(10)
  })

  it('acepta una carpeta sin etiqueta', () => {
    const folders = [{ label: null, folder_url: 'https://drive/x' }]
    expect(instructorTras({ class_folders: folders }).class_folders).toEqual(folders)
  })

  it('acepta la lista vacia, que es como se borran todas', () => {
    expect(instructorTras({ class_folders: [] }).class_folders).toEqual([])
  })

  it('rechaza una carpeta sin link', () => {
    expect(validate({ id: 1, instructor: { class_folders: [{ label: 'sin link' }] } })).toBe(false)
  })
})
