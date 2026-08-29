import { describe, it, expect } from 'vitest'
import { EditionRepository, LEAD_STATUSES_CONSULTA } from '../edition.repository.js'

// El contador de CONSULTAS del cronograma contaba de mas frente a Comercial
// (ESP. EN PYTHON E11-26: 203 vs 191) porque filtraba por lista negra y dejaba
// pasar los leads Eliminados. Estos tests fijan la lista blanca acordada.
describe('classroomLeadsCountList', () => {
  it('cuenta solo los cinco estados que negocio llama consulta', () => {
    expect(LEAD_STATUSES_CONSULTA).toEqual([
      'we_lead_status_atendido',
      'we_lead_status_interesado',
      'we_lead_status_unique',
      'we_lead_status_will_pay',
      'we_lead_status_bought'
    ])
  })

  it.each([
    'we_lead_status_deleted',
    'we_lead_status_closed',
    'we_lead_status_desestimado',
    'we_lead_status_indiferente',
    'we_lead_status_proximo',
    'we_lead_status_insc',
    'we_lead_status_annulment'
  ])('no cuenta %s', alias => {
    expect(LEAD_STATUSES_CONSULTA).not.toContain(alias)
  })

  it('pasa la lista blanca a la query, no una lista negra', async () => {
    let captured
    const db = { query: async (sql, params) => { captured = { sql, params }; return { rows: [] } } }
    await new EditionRepository(db).classroomLeadsCountList([15871])

    expect(captured.params[1]).toBe(LEAD_STATUSES_CONSULTA)
    expect(captured.sql).toContain('cs.alias = ANY($2::text[])')
    expect(captured.sql).not.toContain('NOT IN')
  })
})
