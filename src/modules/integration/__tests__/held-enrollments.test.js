import { describe, it, expect } from 'vitest'
import { HELD_ENROLLMENT_IDS, EXCLUDE_HELD } from '../integration.repository.js'

// Las ordenes de pago del flujo antiguo no deben llegar a las hojas hasta que
// el alumno pague. Si el predicado deja de nombrar un id o la lista se vacia
// generando SQL invalido, estas ventas sin cobrar aparecerian en el Sheet.
describe('EXCLUDE_HELD', () => {
  it('nombra a cada inscripcion retenida y tambien a sus hijas', () => {
    for (const id of HELD_ENROLLMENT_IDS) expect(EXCLUDE_HELD).toContain(String(id))
    expect(EXCLUDE_HELD).toContain('e.enrollment_id NOT IN')
    expect(EXCLUDE_HELD).toContain('COALESCE(e.parent_enrollment_id, 0) NOT IN')
  })

  it('nunca produce un NOT IN () vacio', () => {
    expect(EXCLUDE_HELD).not.toContain('IN ()')
  })
})
