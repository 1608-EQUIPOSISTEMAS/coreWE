import { describe, it, expect } from 'vitest'
import { matchGradesToEvaluations } from '../odooClient.js'

const ev = (id, sid, name) => ({ id, student_id: [sid, name], partner_id: [sid + 1000, name] })
const g = (enrollment_id, student_name, odoo_student_id = null) => ({ enrollment_id, student_name, odoo_student_id })

describe('matchGradesToEvaluations (cruce alumno ERP -> aula Odoo)', () => {
  it('usa el id guardado si existe en el aula', () => {
    const r = matchGradesToEvaluations([ev(1, 10, 'PEREZ JUAN')], [g(100, 'OTRO NOMBRE', 10)])
    expect(r.matched[0]).toMatchObject({ enrollment_id: 100, student_id: 10, eval_ids: [1] })
    expect(r.resolvedByName).toEqual([])
  })
  it('sin id cruza por nombre (tildes, B/V y apellido materno ausente) y lo deja para backfill', () => {
    const r = matchGradesToEvaluations([ev(1, 10, 'CORDOBA RAMOS JOSE')], [g(100, 'Córdova Ramos José Luis')])
    expect(r.matched[0].student_id).toBe(10)
    expect(r.resolvedByName).toEqual([{ enrollment_id: 100, odoo_student_id: 10 }])
  })
  it('persona duplicada en Odoo: nota a todas sus filas, la primera certifica', () => {
    const r = matchGradesToEvaluations([ev(1, 10, 'AVILA ANA'), ev(2, 11, 'AVILA ANA')], [g(100, 'AVILA ANA')])
    expect(r.matched[0]).toMatchObject({ student_id: 10, all_sids: [10, 11], eval_ids: [1, 2] })
    expect([...r.duplicateSids]).toEqual([11])
  })
  it('nombres distintos que calzan los dos: ambiguo, no adivina', () => {
    const r = matchGradesToEvaluations([ev(1, 10, 'GARCIA LUIS PEDRO'), ev(2, 11, 'GARCIA LUIS MARIO')], [g(100, 'GARCIA LUIS')])
    expect(r.matched).toEqual([])
    expect(r.missing).toEqual(['GARCIA LUIS'])
  })
})
