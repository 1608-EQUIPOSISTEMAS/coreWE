import { describe, it, expect } from 'vitest'
import { summarizeStudentCourses, studentCourseStatus, parseStudentQuery } from '../edition.entity.js'

const HOY = '2026-10-05'
const aula = (extra) => ({ start_date: '2026-08-01', end_date: '2026-09-01', type_status_alias: null, final_grade: null, odoo_cert_code: null, ...extra })

describe('studentCourseStatus', () => {
  it('por fechas: Proximo / Activo / Finalizado (el dia de fin sigue Activo)', () => {
    expect(studentCourseStatus(aula({ start_date: '2026-10-10' }), HOY)).toBe('Proximo')
    expect(studentCourseStatus(aula({ end_date: HOY }), HOY)).toBe('Activo')
    expect(studentCourseStatus(aula(), HOY)).toBe('Finalizado')
  })
  it('la salida del aula gana sobre las fechas', () => {
    expect(studentCourseStatus(aula({ type_status_alias: 'we_enrollment_status_retired' }), HOY)).toBe('Retirado')
    expect(studentCourseStatus(aula({ type_status_alias: 'we_enrollment_status_reprogrammed', end_date: '2026-12-01' }), HOY)).toBe('Reprogramado')
  })
})

describe('summarizeStudentCourses', () => {
  it('cursos llevados no cuenta retiros/CC/RP; aprobado = finalizado con nota >= 12', () => {
    const { summary, courses } = summarizeStudentCourses([
      aula({ final_grade: 15, odoo_cert_code: 'P-1' }),
      aula({ final_grade: 11 }),
      aula({ end_date: '2026-12-01' }),
      aula({ type_status_alias: 'we_enrollment_status_course_changed', final_grade: 18 })
    ], HOY)
    expect(summary).toEqual({ taken: 3, active: 1, finished: 2, approved: 1, certified: 1, exited: 1 })
    expect(courses.map((c) => c.status)).toEqual(['Finalizado', 'Finalizado', 'Activo', 'Cambio de curso'])
  })
  it('sin aulas: todo en cero', () => {
    expect(summarizeStudentCourses([], HOY).summary.taken).toBe(0)
  })
})

describe('parseStudentQuery', () => {
  it('DNI o celular: solo digitos, sin espacios ni +', () => {
    expect(parseStudentQuery(' 70123456 ')).toEqual({ digits: '70123456', email: null, nameTokens: null })
    expect(parseStudentQuery('+51 987 654 321').digits).toBe('51987654321')
  })
  it('correo en minusculas y sin comodines de LIKE', () => {
    expect(parseStudentQuery('Ana_P%@Gmail.com').email).toBe('anap@gmail.com')
  })
  it('nombre: palabras en mayusculas sin tildes; descarta letras sueltas', () => {
    expect(parseStudentQuery('josé  Pérez q').nameTokens).toEqual(['JOSE', 'PEREZ'])
  })
  it('muy corto o vacio no busca', () => {
    expect(parseStudentQuery('ab')).toBeNull()
    expect(parseStudentQuery('   ')).toBeNull()
    expect(parseStudentQuery('a b c')).toBeNull()
  })
})
