import { describe, it, expect } from 'vitest'
import { attachChildCourses } from '../enrollment-children.js'

// Doble de la BD: devuelve las filas de hijos ya ordenadas, como hace el SQL.
const dbWith = children => ({ query: async () => ({ rows: children }) })

describe('attachChildCourses', () => {
  const children = [
    { parent_enrollment_id: 10, enrollment_id: 11, course_name: 'DATA ANALYTICS', course_full_name: 'DATA ANALYTICS', edition_code: 'E4-26', start_date: '25/04/2026' },
    { parent_enrollment_id: 10, enrollment_id: 12, course_name: 'POWER BI', course_full_name: 'POWER BI', edition_code: 'E10-26', start_date: '18/07/2026' },
    { parent_enrollment_id: 20, enrollment_id: 21, course_name: 'EXCEL', course_full_name: 'EXCEL AVANZADO', edition_code: null, start_date: null }
  ]

  it('agrupa los hijos bajo su padre conservando el orden del SQL', async () => {
    const rows = [{ enrollment_id: '10' }, { enrollment_id: '20' }]
    await attachChildCourses(rows, dbWith(children))

    expect(rows[0].children.map(c => c.course_name)).toEqual(['DATA ANALYTICS', 'POWER BI'])
    expect(rows[1].children).toHaveLength(1)
  })

  it('deja sin children a la venta que no es paquete', async () => {
    const rows = [{ enrollment_id: '10' }, { enrollment_id: '99' }]
    await attachChildCourses(rows, dbWith(children))

    expect(rows[1].children).toBeUndefined()
  })

  // El listado no puede caerse por una consulta de apoyo.
  it('devuelve las filas intactas si la consulta falla', async () => {
    const rows = [{ enrollment_id: '10' }]
    const db = { query: async () => { throw new Error('conexion caida') } }

    await expect(attachChildCourses(rows, db)).resolves.toBe(rows)
    expect(rows[0].children).toBeUndefined()
  })
})
