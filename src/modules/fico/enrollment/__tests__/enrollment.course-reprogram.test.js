import { describe, it, expect } from 'vitest'
import { DomainError } from '../../../../shared/errors.js'
import {
  courseState,
  COURSE_STATE,
  assertFullReprogramAllowed,
  assertCourseReprogrammable,
  buildProgramCourses,
  describeOdooUnenroll,
  odooUnenrollIncomplete
} from '../enrollment.entity.js'

const today = '2026-10-27'

describe('courseState', () => {
  it('por iniciar si arranca despues de hoy o no tiene fecha', () => {
    expect(courseState({ startDate: '2026-11-01', endDate: '2026-11-30', today })).toBe(COURSE_STATE.NOT_STARTED)
    expect(courseState({ startDate: null, endDate: null, today })).toBe(COURSE_STATE.NOT_STARTED)
  })
  it('en curso si ya arranco y no termino (incluye el dia de inicio y el de fin)', () => {
    expect(courseState({ startDate: '2026-10-27', endDate: '2026-11-20', today })).toBe(COURSE_STATE.IN_PROGRESS)
    expect(courseState({ startDate: '2026-10-01', endDate: '2026-10-27', today })).toBe(COURSE_STATE.IN_PROGRESS)
  })
  it('terminado si su fin ya paso', () => {
    expect(courseState({ startDate: '2026-08-23', endDate: '2026-09-20', today })).toBe(COURSE_STATE.FINISHED)
  })
  it('acepta Date con hora local (columna date de node-pg)', () => {
    expect(courseState({ startDate: new Date(2026, 9, 28), endDate: null, today: new Date(2026, 9, 27, 23, 0) }))
      .toBe(COURSE_STATE.NOT_STARTED)
  })
})

describe('assertFullReprogramAllowed', () => {
  it('deja reprogramar el paquete si ningun curso empezo', () => {
    expect(() => assertFullReprogramAllowed({
      children: [{ start_date: '2026-11-10', status_alias: 'we_enrollment_status_tracking' }],
      today
    })).not.toThrow()
  })
  it('bloquea si ya empezo un curso y dice cual (caso #14016)', () => {
    expect(() => assertFullReprogramAllowed({
      children: [
        { child_program_name: 'PLAN. FINANCIERO', start_date: '2026-08-23', end_date: '2026-09-20', status_alias: 'we_enrollment_status_tracking' },
        { child_program_name: 'COST Y PRESUP', start_date: '2026-11-29', status_alias: 'we_enrollment_status_tracking' }
      ],
      today
    })).toThrow(/PLAN\. FINANCIERO.*reprograma solo los cursos/)
  })
  it('ignora los cursos que ya dejaron el aula (retirados, RP, CC)', () => {
    expect(() => assertFullReprogramAllowed({
      children: [{ start_date: '2026-08-23', status_alias: 'we_enrollment_status_reprogrammed' }],
      today
    })).not.toThrow()
  })
})

describe('assertCourseReprogrammable', () => {
  const course = { enrollment_id: 5, parent_enrollment_id: 1, child_program_name: 'SQL AVANZ', start_date: '2026-11-28', status_alias: 'we_enrollment_status_tracking' }

  it('acepta un curso vivo por iniciar o en curso del mismo paquete', () => {
    expect(() => assertCourseReprogrammable({ course, parentEnrollmentId: 1, today })).not.toThrow()
    expect(() => assertCourseReprogrammable({ course: { ...course, start_date: '2026-10-20', end_date: '2026-11-10' }, parentEnrollmentId: 1, today })).not.toThrow()
  })
  it('rechaza un curso de otro paquete', () => {
    expect(() => assertCourseReprogrammable({ course, parentEnrollmentId: 2, today })).toThrow(DomainError)
  })
  it('rechaza un curso terminado: lo cursado no se mueve', () => {
    expect(() => assertCourseReprogrammable({ course: { ...course, start_date: '2026-08-01', end_date: '2026-09-01' }, parentEnrollmentId: 1, today }))
      .toThrow(/ya termino/)
  })
  it('rechaza un curso ya reprogramado o retirado', () => {
    expect(() => assertCourseReprogrammable({ course: { ...course, status_alias: 'we_enrollment_status_reprogrammed' }, parentEnrollmentId: 1, today }))
      .toThrow(/ya no esta vigente/)
  })
  it('rechaza si el curso no existe', () => {
    expect(() => assertCourseReprogrammable({ course: null, parentEnrollmentId: 1, today })).toThrow(DomainError)
  })
})

describe('buildProgramCourses', () => {
  it('marca el estado, cuenta los reprogramados y enlaza origen y destino', () => {
    const { courses, reprogrammed_count } = buildProgramCourses({
      today,
      rows: [
        { enrollment_id: 10, child_program_name: 'PLAN. FINANCIERO', start_date: '2026-08-23', end_date: '2026-09-20', status_alias: 'we_enrollment_status_tracking' },
        { enrollment_id: 11, child_program_name: 'COST Y PRESUP', start_date: '2026-11-29', status_alias: 'we_enrollment_status_reprogrammed', reprogrammed_to: 12 },
        { enrollment_id: 12, child_program_name: 'COST Y PRESUP', start_date: '2026-12-17', status_alias: 'we_enrollment_status_tracking' }
      ]
    })
    expect(reprogrammed_count).toBe(1)
    expect(courses.map(c => c.state)).toEqual([COURSE_STATE.FINISHED, null, COURSE_STATE.NOT_STARTED])
    expect(courses[1]).toMatchObject({ reprogrammed: true, reprogrammed_to: 12 })
    expect(courses[2].reprogrammed_from).toBe(11)
  })
})

describe('describeOdooUnenroll', () => {
  it('dice que se quito y que hay que revisar a mano', () => {
    const res = { removed: ['Costos & Presupuestos (29/11) - Noviembre 2026'], missing: ['SAP S/4 HANA FI (10/01) - Enero 2027'], cancelledOrders: [5812692] }
    expect(describeOdooUnenroll(res)).toBe('retirado de Costos & Presupuestos (29/11) - Noviembre 2026 | orden(es) 5812692 cancelada(s) | REVISAR A MANO: SAP S/4 HANA FI (10/01) - Enero 2027')
    expect(odooUnenrollIncomplete(res)).toBe(true)
  })
  it('sin nada que hacer no inventa un "desinscrito"', () => {
    expect(describeOdooUnenroll({})).toBe('sin aulas que quitar')
    expect(odooUnenrollIncomplete({ removed: ['x'], missing: [] })).toBe(false)
    expect(odooUnenrollIncomplete(null)).toBe(false)
  })
})
