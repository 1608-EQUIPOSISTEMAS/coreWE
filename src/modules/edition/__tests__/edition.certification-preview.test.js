import { describe, it, expect } from 'vitest'
import { classifyCertificationPreview, classroomCertificationStatus } from '../edition.entity.js'

const g = (enrollment_id, student_name, final_score = 15, has_debt = false) => ({ enrollment_id, student_name, final_score, has_debt })
const s = (enrollment_id, in_odoo = true, already_certified = false) => ({ enrollment_id, in_odoo, already_certified })

describe('classifyCertificationPreview', () => {
  it('reparte cada alumno en un solo grupo, en orden de prioridad', () => {
    const r = classifyCertificationPreview(
      [g(1, 'LISTA'), g(2, 'YA', 18), g(3, 'DEUDA', 16, true), g(4, 'JALADO', 10), g(5, 'FUERA'), g(6, 'YA CON DEUDA', 15, true)],
      [s(1), s(2, true, true), s(3), s(4), s(5, false), s(6, true, true)],
      ['SIN NOTA']
    )
    expect(r).toEqual({
      ready: ['LISTA'],
      already_certified: ['YA', 'YA CON DEUDA'],
      with_debt: ['DEUDA'],
      likely_failed: ['JALADO'],
      not_in_odoo: ['FUERA'],
      without_grade: ['SIN NOTA'],
      odoo_classroom_empty: false
    })
  })
  it('12 exacto aprueba', () => {
    expect(classifyCertificationPreview([g(1, 'DOCE', 12)], [s(1)]).ready).toEqual(['DOCE'])
  })
  it('alumno con dos filas (hijo de dos paquetes) sale una vez', () => {
    expect(classifyCertificationPreview([g(1, 'RUFASTO', 10), g(2, 'RUFASTO', 10)], [s(1), s(2)]).likely_failed).toEqual(['RUFASTO'])
  })
  it('si nadie esta en el aula de Odoo lo marca como aula vacia', () => {
    expect(classifyCertificationPreview([g(1, 'A'), g(2, 'B')], [s(1, false), s(2, false)]).odoo_classroom_empty).toBe(true)
    expect(classifyCertificationPreview([g(1, 'A'), g(2, 'B')], [s(1, false), s(2)]).odoo_classroom_empty).toBe(false)
  })
})

describe('classroomCertificationStatus (filtro Por certificar)', () => {
  it('sin aprobados no aplica', () => {
    expect(classroomCertificationStatus({ approved: 0, certified: 0 })).toBeNull()
  })
  it('pendiente si faltan certificados', () => {
    expect(classroomCertificationStatus({ approved: 20, certified: 0 })).toEqual({ label: 'Sin certificar', tone: 'bad', pending: true })
    expect(classroomCertificationStatus({ approved: 20, certified: 15 })).toMatchObject({ label: 'Certificados 15 de 20', pending: true })
  })
  it('completa cuando Odoo tiene al menos tantos certificados como aprobados', () => {
    expect(classroomCertificationStatus({ approved: 20, certified: 22 }).pending).toBe(false)
  })
})
