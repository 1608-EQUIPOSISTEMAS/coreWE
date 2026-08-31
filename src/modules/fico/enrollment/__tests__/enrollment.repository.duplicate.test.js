import { describe, it, expect } from 'vitest'
import { EnrollmentRepository } from '../enrollment.repository.js'

// El guard de duplicados solo debe mirar a quien SIGUE ocupando la edicion.
// Un origen en estado terminal (CC/RP/R/Anulado) bloqueaba el asiento para
// siempre: el socio que financio su WE GOLD con esa venta no podia volver a
// entrar al mismo curso con el beneficio de la membresia.
const TERMINAL = [
  'we_enrollment_status_course_changed',
  'we_enrollment_status_reprogrammed',
  'we_enrollment_status_retired',
  'we_enrollment_status_annulment'
]

function repoQueSoloCapturaElSql () {
  const sqls = []
  const db = { query: async (text) => { sqls.push(text); return { rows: [] } } }
  return { repo: new EnrollmentRepository(db), sqls }
}

describe('guard de duplicados', () => {
  it('findDuplicate ignora las inscripciones en estado terminal', async () => {
    const { repo, sqls } = repoQueSoloCapturaElSql()
    await repo.findDuplicate({ programEditionId: 15070, doc: '70120821', mail: null })
    for (const alias of TERMINAL) expect(sqls[0]).toContain(alias)
  })

  it('findDuplicateByVersion ignora las inscripciones en estado terminal', async () => {
    const { repo, sqls } = repoQueSoloCapturaElSql()
    await repo.findDuplicateByVersion({ programVersionId: 60, doc: '70120821', mail: null })
    for (const alias of TERMINAL) expect(sqls[0]).toContain(alias)
  })
})
