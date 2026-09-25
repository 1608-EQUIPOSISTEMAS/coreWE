import { describe, it, expect } from 'vitest'
import { EditionRepository } from '../edition.repository.js'

// enrollments.counts_as_sale = decision manual de gerencia: la inscripcion cuenta
// VENTAS aunque sea destino de CC/RP (que por cascada caeria en SEGUI). Tiene que
// evaluarse ANTES de esa rama (primer WHEN gana) y ceder ante la beca, si no la
// fila descuadra: AULA excluye becas y VENTAS no.
describe('comm_bucket: venta por decision de gerencia', () => {
  it('gana sobre el seguimiento del CC y cede ante la beca', async () => {
    let sql = ''
    const repo = new EditionRepository({ query: (text) => { sql = text; return { rows: [] } } })
    await repo.classroomChannelMetricsList([1])

    const override = sql.indexOf("WHEN e.counts_as_sale AND NOT bec.is_beca THEN 'VENTAS'")
    const cambioDeCurso = sql.indexOf('WHEN EXISTS (SELECT 1 FROM public.course_changes cc')
    expect(override).toBeGreaterThan(-1)
    expect(override).toBeLessThan(cambioDeCurso)
  })
})
