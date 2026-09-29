import { describe, it, expect } from 'vitest'
import { rubricCompliance, criteriaWindow } from '../edition.entity.js'

// Ordena dónde capacitar para llegar al objetivo 18: si el aporte se calcula
// mal, Académica entrena a los docentes en el criterio equivocado.
describe('rubricCompliance', () => {
  it('ordena por cuántos puntos del promedio suma arreglar cada criterio', () => {
    const vigente = (fallas) => ({
      fecha: '2026-09-20',
      criteria: Object.fromEntries(
        ['interaction.2', 'interaction.4', 'content.2', 'content.3', 'content.5', 'environment.1',
          'environment.2', 'communication.1', 'communication.2', 'communication.5']
          .map((k) => [k, !fallas.includes(k)]))
    })
    const [peor, segundo] = rubricCompliance([
      vigente(['environment.2', 'content.3']),
      vigente(['environment.2'])
    ])
    // rúbrica vigente: 2 pts por criterio; environment.2 falla en las 2 auditorías
    expect(peor).toMatchObject({ key: 'environment.2', auditorias: 2, cumplidas: 0, pct: 0, aporte: 2 })
    expect(segundo).toMatchObject({ key: 'content.3', pct: 50, aporte: 1 })
  })

  it('una auditoría vieja vale 1 pt por criterio y los criterios retirados no se listan', () => {
    const criterios = rubricCompliance([{ fecha: '2026-09-01', criteria: { 'content.6': false, 'interaction.2': false } }])
    expect(criterios.find((c) => c.key === 'content.6')).toBeUndefined()
    expect(criterios.find((c) => c.key === 'interaction.2').aporte).toBe(1)
  })
})

describe('criteriaWindow', () => {
  it('con base suficiente usa el periodo elegido', () => {
    expect(criteriaWindow({ desde: '2026-09-01', hasta: '2026-09-28', auditoriasEnPeriodo: 20 }))
      .toEqual({ desde: '2026-09-01', hasta: '2026-09-28', ampliada: false })
  })

  it('con poca base amplía a los últimos 90 días hasta el fin del periodo', () => {
    expect(criteriaWindow({ desde: '2026-08-30', hasta: '2026-09-28', auditoriasEnPeriodo: 3 }))
      .toEqual({ desde: '2026-07-01', hasta: '2026-09-28', ampliada: true })
  })
})
