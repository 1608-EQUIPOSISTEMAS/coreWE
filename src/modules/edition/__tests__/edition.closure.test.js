import { describe, it, expect } from 'vitest'
import { buildClosureRow, closingDateOf, CLOSURE_CHECKS } from '../edition.entity.js'

// El cierre de un aula NO es su end_date planificado: una reprogramacion al
// final lo corre a otra semana, y la bandeja de cierres filtra por esa fecha.
// Si esto se rompe, el aula se revisa la semana equivocada y el certificado
// sale tarde (que es justo lo que la hoja "CIERRE DE CURSOS" viene a evitar).
const AULA = {
  edition_num_id: 15098,
  abbreviation: 'COST Y PRESUP',
  class_code: 'CYP-20/08/26',
  specific_code: 'E6-26',
  instructor: 'Carlos Vargas',
  start_date: '2026-08-20',
  end_date: '2026-09-01',
  total_sessions: 6,
  sessions: [
    { session_number: 5, date: '2026-08-30' },
    { session_number: 6, date: '2026-09-08' } // reprogramada mas alla del fin
  ]
}

describe('closingDateOf', () => {
  it('usa la ultima sesion, no el end_date planificado', () => {
    expect(closingDateOf(AULA)).toBe('2026-09-08')
  })

  it('cae al end_date cuando el aula no tiene cronograma derivado', () => {
    expect(closingDateOf({ ...AULA, sessions: [] })).toBe('2026-09-01')
  })
})

describe('buildClosureRow', () => {
  it('un aula sin fila en edition_closure arranca con todo sin marcar', () => {
    const row = buildClosureRow(AULA, [])
    expect(row.done_count).toBe(0)
    expect(Object.keys(row.checks)).toEqual(CLOSURE_CHECKS.map((c) => c.field))
    expect(Object.values(row.checks).every((v) => v === false)).toBe(true)
  })

  it('cuenta solo las tareas de SU aula', () => {
    const row = buildClosureRow(AULA, [
      { program_edition_id: 15098, grades_delivered: true, certificate_done: true },
      { program_edition_id: 99999, debt_validated: true }
    ])
    expect(row.done_count).toBe(2)
    expect(row.checks.grades_delivered).toBe(true)
    expect(row.checks.debt_validated).toBe(false)
    expect(row.closing_date).toBe('2026-09-08')
    expect(row.class_code).toBe('CYP-20/08/26')
  })
})
