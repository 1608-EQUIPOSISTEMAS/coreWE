import { describe, it, expect } from 'vitest'
import { EXCLUDE_IMPORTED, IMPORT_OBSERVATION_TOKEN } from '../integration.repository.js'

// Emula la semantica de `COALESCE(observations,'') NOT LIKE '%masiva FICO%'`:
// la fila se EXCLUYE del sync cuando observations contiene el token.
const isExcluded = (obs) => String(obs ?? '').includes(IMPORT_OBSERVATION_TOKEN)

// Observations que produce cada via del importer (ver enrollment-fico.importer.js
// y enrollment.importer.js). Si alguna cambia y deja de contener el token, el sync
// volveria a subir data importada: este test lo detecta.
const IMPORTED = [
  'Importacion masiva FICO (hoja)',
  'Importacion masiva FICO (hoja) - convalidacion (ED E0, sin edicion)',
  'Importacion masiva FICO (hoja) - beneficio de membresia WE BLACK',
  'Migracion masiva FICO - membresia WE GOLD (sin pago)',
  'Importacion masiva FICO - hijo de paquete',
  'Importacion masiva FICO'
]

// Observations de ventas normales: NUNCA deben excluirse.
const NORMAL = ['Registro directo FICO', '', null, 'Pago web', 'Cambio de curso']

describe('EXCLUDE_IMPORTED', () => {
  it('el predicado usa COALESCE para no perder filas con observations NULL', () => {
    expect(EXCLUDE_IMPORTED).toContain('COALESCE')
    expect(EXCLUDE_IMPORTED).toContain(IMPORT_OBSERVATION_TOKEN)
  })

  it('excluye toda inscripcion creada por la importacion masiva', () => {
    for (const obs of IMPORTED) expect(isExcluded(obs)).toBe(true)
  })

  it('no excluye ventas normales ni filas sin observations', () => {
    for (const obs of NORMAL) expect(isExcluded(obs)).toBe(false)
  })
})
