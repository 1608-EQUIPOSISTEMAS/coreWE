import { describe, it, expect } from 'vitest'
import {
  parseReportRecommendations,
  buildReportRecommendationsPrompt
} from '../../src/modules/edition/edition.entity.js'

const VALID = JSON.stringify([
  { etiqueta: 'cobertura', titulo: 'Completar evidencia', detalle: 'Subir sesiones faltantes.', responsable: 'Coordinadores' },
  { etiqueta: 'ACOMPANAMIENTO', titulo: 'Mentoria docente', detalle: 'Agendar retroalimentacion.', responsable: 'Jefatura' },
  { etiqueta: 'RECONOCIMIENTO', titulo: 'Difundir buenas practicas', detalle: 'Compartir con el equipo.', responsable: 'Direccion' }
])

describe('parseReportRecommendations', () => {
  it('parsea un array JSON limpio y normaliza etiquetas a mayusculas', () => {
    const items = parseReportRecommendations(VALID)
    expect(items).toHaveLength(3)
    expect(items[0].etiqueta).toBe('COBERTURA')
    expect(items[0].titulo).toBe('Completar evidencia')
  })

  it('rescata el JSON aunque el modelo lo envuelva en texto o markdown', () => {
    const wrapped = 'Claro, aqui tienes:\n```json\n' + VALID + '\n```\nEspero que ayude.'
    expect(parseReportRecommendations(wrapped)).toHaveLength(3)
  })

  it('recorta a 3 si el modelo devuelve de mas', () => {
    const four = JSON.parse(VALID)
    four.push({ etiqueta: 'X', titulo: 'Extra', detalle: 'Extra.', responsable: 'Y' })
    expect(parseReportRecommendations(JSON.stringify(four))).toHaveLength(3)
  })

  it('descarta items sin titulo o detalle', () => {
    const bad = JSON.stringify([
      { etiqueta: 'A', titulo: '', detalle: 'x', responsable: 'r' },
      { etiqueta: 'B', titulo: 't', detalle: 'd', responsable: 'r' }
    ])
    expect(parseReportRecommendations(bad)).toHaveLength(1)
  })

  it('devuelve [] con JSON roto, sin array o texto vacio', () => {
    expect(parseReportRecommendations('no hay json aca')).toEqual([])
    expect(parseReportRecommendations('[{"etiqueta": roto]')).toEqual([])
    expect(parseReportRecommendations('{"un": "objeto"}')).toEqual([])
    expect(parseReportRecommendations('')).toEqual([])
    expect(parseReportRecommendations(null)).toEqual([])
  })
})

describe('buildReportRecommendationsPrompt', () => {
  it('incluye los indicadores del snapshot y exige JSON de 3', () => {
    const { system, user } = buildReportRecommendationsPrompt({
      period_start: '2026-06-17',
      period_end: '2026-07-16',
      total: 61, evaluated: 45, at_risk: 32,
      avg_consolidated: 14.5, avg_ia: 13.2, avg_manual: 17.7,
      goal: 17, coverage_pct: 55, coverage_ia_pct: 55, coverage_manual_pct: 55,
      worst_teachers: [{ name: 'Jose Botonero', avg: 10.7, at_risk: 1, total: 2 }],
      critical_aulas: [{ code: 'E9', name: 'CONT. FINANCIERA', score: 10.7, verdict: 'DEFICIENTE' }]
    })
    expect(system).toContain('EXACTAMENTE 3')
    expect(user).toContain('14.5')
    expect(user).toContain('Jose Botonero')
    expect(user).toContain('E9 CONT. FINANCIERA')
  })

  it('no explota con snapshot vacio', () => {
    const { user } = buildReportRecommendationsPrompt({})
    expect(user).toContain('sin datos')
  })
})
