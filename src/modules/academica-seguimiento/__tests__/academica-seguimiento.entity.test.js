import { describe, it, expect } from 'vitest'
import { gradeStatus, summarizeClassrooms, withGradeStatus, withOdooData, odooFinalScore, odooGradeRows, mergeGradeRows, withEnrollmentFlow, withDepartures } from '../academica-seguimiento.entity.js'

describe('gradeStatus', () => {
  it('aprueba con 12 o mas', () => {
    expect(gradeStatus({ hasGrade: true, finalGrade: 12 })).toBe('approved')
    expect(gradeStatus({ hasGrade: true, finalGrade: 20 })).toBe('approved')
  })
  it('con 11 desaprueba y no se certifica', () => {
    expect(gradeStatus({ hasGrade: true, finalGrade: 11 })).toBe('failed')
    expect(gradeStatus({ hasGrade: true, finalGrade: 0 })).toBe('failed')
  })
  it('se redondea antes de comparar: 11.5 aprueba, 11.49 no', () => {
    expect(gradeStatus({ hasGrade: true, finalGrade: '11.50' })).toBe('approved')
    expect(gradeStatus({ hasGrade: true, finalGrade: '11.49' })).toBe('failed')
  })
  it('sin nota cargada no es desaprobado', () => {
    expect(gradeStatus({ hasGrade: false, finalGrade: 0 })).toBe('no_grade')
    expect(gradeStatus({ hasGrade: true, finalGrade: null })).toBe('no_grade')
  })
})

describe('summarizeClassrooms', () => {
  const classrooms = [
    { edition_id: 1, course: 'EXCEL' },
    { edition_id: 2, course: 'POWER BI' },
    { edition_id: 3, course: 'SIN ALUMNOS' }
  ]
  const rows = [
    { edition_id: 1, has_grade: true, final_grade: '15.00' },
    { edition_id: 1, has_grade: true, final_grade: '11.00' },
    { edition_id: 1, has_grade: false, final_grade: null },
    { edition_id: 2, has_grade: true, final_grade: '11.50' }
  ]
  const { items, kpis } = summarizeClassrooms(classrooms, rows)

  it('cuenta por estado en cada aula y deja fuera las aulas sin alumnos', () => {
    expect(items).toEqual([
      { edition_id: 1, course: 'EXCEL', students: 3, approved: 1, failed: 1, no_grade: 1 },
      { edition_id: 2, course: 'POWER BI', students: 1, approved: 1, failed: 0, no_grade: 0 }
    ])
  })
  it('los KPIs suman todas las aulas listadas', () => {
    expect(kpis).toEqual({ classrooms: 2, students: 4, approved: 2, failed: 1, no_grade: 1 })
  })
})

describe('withGradeStatus', () => {
  it('pone el estado y la nota como numero, o null si no tiene nota', () => {
    const out = withGradeStatus([
      { enrollment_id: 1, has_grade: true, final_grade: '13.25' },
      { enrollment_id: 2, has_grade: false, final_grade: '0.00' }
    ])
    expect(out.map(s => [s.final_grade, s.status])).toEqual([[13.25, 'approved'], [null, 'no_grade']])
  })
})

describe('withOdooData', () => {
  const erp = { edition_id: 1, odoo_activation: 'X', course: 'LEAN LOG.', instructor: 'Ana', instructor_email: 'ana@erp.pe', sessions: 8, days: 'Lun', hours: '7pm', start_date: '2026-10-01', end_date: '2026-11-01' }
  it('manda Odoo y un campo vacio en Odoo deja el del ERP', () => {
    const odoo = new Map([[1, { course: 'Lean Logistics', instructor: 'Ana P.', instructor_email: null, sessions: null, schedule: '7:00pm - 10:00pm | Lunes', start_date: '2026-10-02', end_date: null }]])
    const [r] = withOdooData([erp], odoo)
    expect(r).toMatchObject({ course: 'Lean Logistics', instructor: 'Ana P.', instructor_email: 'ana@erp.pe', sessions: 8, days: '7:00pm - 10:00pm | Lunes', hours: null, start_date: '2026-10-02', end_date: '2026-11-01', source: 'odoo' })
    expect(r).not.toHaveProperty('odoo_activation')
  })
  it('el docente generico de Odoo no pisa el nombre real del ERP', () => {
    const [r] = withOdooData([erp], new Map([[1, { instructor: 'Especialista WE', instructor_email: 'ana@we.pe' }]]))
    expect(r).toMatchObject({ instructor: 'Ana', instructor_email: 'ana@we.pe' })
  })
  it('sin grupo en Odoo queda tal cual el ERP', () => {
    const [r] = withOdooData([erp], new Map())
    expect(r).toMatchObject({ course: 'LEAN LOG.', days: 'Lun', hours: '7pm', source: 'erp' })
  })
})

describe('odooFinalScore', () => {
  const s = (mid, fin, sub = 0) => odooFinalScore({ midterm_exam: mid, final_exam: fin, substitute_exam: sub })
  it('promedia parcial y final', () => expect(s(12, 15)).toBe(13.5))
  it('el sustitutorio reemplaza la nota mas baja', () => {
    expect(s(12, 15, 13)).toBe(14)
    expect(s(18, 18, 1)).toBe(9.5)
  })
  it('se topa en 20 (sustitutorio mal digitado)', () => expect(s(20, 20, 1995)).toBe(20))
  it('sin ninguna nota cargada es sin nota, no cero', () => expect(s(0, 0)).toBeNull())
})

describe('notas de Odoo por aula', () => {
  const evals = [
    { slide_group_id: [7, 'G'], midterm_exam: 15, final_exam: 15, substitute_exam: 0 },
    { slide_group_id: [7, 'G'], midterm_exam: 0, final_exam: 0, substitute_exam: 0 }
  ]
  it('arma filas por aula y dos aulas del mismo grupo reciben las mismas', () => {
    const rows = odooGradeRows(new Map([[1, 7], [2, 7]]), evals)
    expect(rows).toHaveLength(4)
    expect(rows.filter(r => r.edition_id === 1)).toEqual([
      { edition_id: 1, final_grade: 15, has_grade: true },
      { edition_id: 1, final_grade: null, has_grade: false }
    ])
  })
  it('un aula con alumnos en Odoo usa solo Odoo; sin ellos queda el ERP', () => {
    const erp = [{ edition_id: 1, final_grade: '08', has_grade: true }, { edition_id: 3, final_grade: '14', has_grade: true }]
    const merged = mergeGradeRows(erp, odooGradeRows(new Map([[1, 7], [3, 99]]), evals))
    expect(merged.filter(r => r.edition_id === 1).map(r => r.final_grade)).toEqual([15, null])
    expect(merged.filter(r => r.edition_id === 3).map(r => r.final_grade)).toEqual(['14'])
  })
})

describe('withEnrollmentFlow', () => {
  const aula = { edition_id: 1, students: 20, approved: 12, failed: 5, end_date: '2026-10-20' }
  it('inscritos iniciales = los que siguen + retirados', () => {
    const [r] = withEnrollmentFlow([aula], new Map([[1, 3]]), '2026-10-26')
    expect(r).toMatchObject({ retired: 3, initial: 23 })
  })
  it('en aula finalizada culminaron = con nota final (aprobados + desaprobados)', () => {
    expect(withEnrollmentFlow([aula], new Map(), '2026-10-26')[0]).toMatchObject({ retired: 0, initial: 20, completed: 17 })
  })
  it('en aula que aun no termina (incluye el ultimo dia) culminaron es null', () => {
    expect(withEnrollmentFlow([aula], new Map(), '2026-10-20')[0].completed).toBeNull()
  })
})

describe('withDepartures', () => {
  it('los que salieron van al final, sin nota y con su motivo', () => {
    const r = withDepartures([{ enrollment_id: 1, full_name: 'B', status: 'approved' }],
      [{ enrollment_id: 9, full_name: 'A', document_number: '1', email: 'a@x.pe', reason: 'we_enrollment_status_reprogrammed' }])
    expect(r.map(x => x.full_name)).toEqual(['B', 'A'])
    expect(r[1]).toMatchObject({ enrollment_id: 'salida-9', final_grade: null, status: 'retired', reason: 'we_enrollment_status_reprogrammed' })
  })
})
