import { describe, it, expect, vi } from 'vitest'

// El panel real de resultados arrastra edition -> Odoo (exige credenciales al
// importar). Aqui los resultados del area se inyectan con fetchAreaResults.
vi.mock('../../results/results.usecases.js', () => ({ areaResults: async () => null }))
vi.mock('../../results/comercial.repository.js', () => ({ fetchComercialRaw: async () => ({ asesores: [], seguimiento: [] }) }))

import { generateDailyPlans, getDailyPlan, regenerableAreas } from '../daily-plan.usecases.js'

// Repo en memoria con el mismo contrato que daily-plan.repository.
function fakeRepo (filas = []) {
  const guardadas = [...filas]
  return {
    guardadas,
    withGenerationLock: (fn) => fn(),
    currentDate: async () => '2026-09-22',
    fetchAdvisors: async () => [],
    fetchCandidateLeads: async () => [],
    savePlan: async ({ planDate, area, userId, payload }) => {
      guardadas.push({ plan_date: planDate, area, user_id: userId, payload, generated_at: '2026-09-22 06:40' })
    },
    fetchLatestPlans: async ({ area, userId = null }) => guardadas
      .filter(r => r.area === area && (userId === null || r.user_id === userId || r.user_id === null))
  }
}

const silencio = { log () {}, warn () {}, error () {} }
const panelFico = {
  titular: { texto: '2 ventas esperan validación.', tono: 'warn' },
  tarjetas: [],
  filas: [{ widgets: [{ tipo: 'ranking', titulo: 'Ventas que más esperan', unidad: 'num', items: [{ label: 'Ana', valor: 5, tono: 'bad', ruta: '/fico/inscripciones/1' }] }] }]
}

describe('generateDailyPlans (áreas)', () => {
  it('arma una fila por área con las dos redacciones del modelo', async () => {
    const repo = fakeRepo()
    const pedidos = []
    const llm = async (messages) => { pedidos.push(messages[0].content); return `Texto ${pedidos.length}.` }
    await generateDailyPlans({ areas: ['FICO'], repo, llm, fetchAreaResults: async () => panelFico, log: silencio })

    expect(repo.guardadas).toHaveLength(1)
    const { area, user_id: userId, payload } = repo.guardadas[0]
    expect([area, userId]).toEqual(['FICO', null])
    expect(payload.resumen_lider).toBe('Texto 1.')
    expect(payload.enfoque_colaborador).toBe('Texto 2.')
    expect(payload.pendientes[0].titulo).toBe('Ana')
    expect(pedidos[0]).toContain('líderes')
  })

  it('con el modelo caído deja la fila con el respaldo y no reintenta sin fin', async () => {
    const repo = fakeRepo()
    let llamadas = 0
    const llm = async () => { llamadas++; throw new Error('Ollama respondio 500') }
    await generateDailyPlans({ areas: ['FICO', 'ACADEMICA', 'PRODUCTO'], repo, llm, fetchAreaResults: async () => panelFico, log: silencio })
    expect(llamadas).toBe(2) // MAX_LLM_FAILS: a la segunda falla ya no se llama
    expect(repo.guardadas).toHaveLength(3)
    expect(repo.guardadas[0].payload.resumen_lider).toContain('Lo primero hoy: Ana')
  })

  it('un área que falla no deja sin plan a las demás', async () => {
    const repo = fakeRepo()
    const fetchAreaResults = async (leader) => { if (leader === 'LIDER_FICO') throw new Error('tabla rota'); return panelFico }
    const out = await generateDailyPlans({ areas: ['FICO', 'PRODUCTO'], repo, llm: async () => 'Ok hoy.', fetchAreaResults, log: silencio })
    expect(out.areas.FICO.error).toBe('tabla rota')
    expect(repo.guardadas.map(r => r.area)).toEqual(['PRODUCTO'])
  })
})

describe('getDailyPlan', () => {
  const filaArea = { plan_date: '2026-09-22', area: 'FICO', user_id: null, generated_at: 'x', payload: { area: 'FICO', resumen_lider: 'Para el líder.', enfoque_colaborador: 'Para ti.', pendientes: [] } }
  const filaAsesor = { plan_date: '2026-09-22', area: 'COMERCIAL', user_id: 7, generated_at: 'x', payload: { nombre: 'Rosa', nota_lider: 'Solo líder', enfoque_asesor: 'Hoy llama a 3', plan: { leads: [] }, mes: {} } }

  it('el líder del área ve el resumen dirigido a él', async () => {
    const r = await getDailyPlan({ roles: ['LIDER_FICO'], userId: 1 }, fakeRepo([filaArea]))
    expect(r).toMatchObject({ tipo: 'area', rol: 'lider', area: 'FICO' })
    expect(r.plan.resumen_lider).toBe('Para el líder.')
  })

  it('el colaborador ve el mismo plan sin el resumen del líder', async () => {
    const r = await getDailyPlan({ roles: ['FICO'], userId: 2 }, fakeRepo([filaArea]))
    expect(r).toMatchObject({ tipo: 'area', rol: 'colaborador' })
    expect(r.plan.enfoque_colaborador).toBe('Para ti.')
    expect(r.plan).not.toHaveProperty('resumen_lider')
  })

  it('el asesor comercial ve solo lo suyo y sin la nota al líder', async () => {
    const r = await getDailyPlan({ roles: ['COMERCIAL'], userId: 7 }, fakeRepo([filaAsesor]))
    expect(r).toMatchObject({ tipo: 'comercial', rol: 'asesor' })
    expect(r.plan).not.toHaveProperty('nota_lider')
  })

  it('ADMIN mirando un área la ve como su líder; un área apagada no da plan', async () => {
    const admin = await getDailyPlan({ roles: ['ADMIN'], userId: 1, viewAs: 'LIDER_FICO' }, fakeRepo([filaArea]))
    expect(admin.rol).toBe('lider')
    const apagada = await getDailyPlan({ roles: ['FICO'], userId: 2 }, fakeRepo([filaArea]), ['COMERCIAL'])
    expect(apagada).toEqual({ rol: null })
  })

  it('sin plan generado todavía lo dice (plan_date null)', async () => {
    const r = await getDailyPlan({ roles: ['LIDER_PRODUCTO'], userId: 3 }, fakeRepo())
    expect(r).toMatchObject({ tipo: 'area', rol: 'lider', plan_date: null })
  })
})

describe('regenerableAreas', () => {
  it('cada líder solo la suya; ADMIN todas o la que mira; colaborador ninguna', () => {
    expect(regenerableAreas({ roles: ['LIDER_ACADEMICA'] })).toEqual(['ACADEMICA'])
    expect(regenerableAreas({ roles: ['LIDER_COMERCIAL'] })).toEqual(['COMERCIAL'])
    expect(regenerableAreas({ roles: ['ADMIN'] })).toEqual(['COMERCIAL', 'FICO', 'ACADEMICA', 'PRODUCTO'])
    expect(regenerableAreas({ roles: ['ADMIN'], viewAs: 'LIDER_PRODUCTO' })).toEqual(['PRODUCTO'])
    expect(regenerableAreas({ roles: ['FICO'] })).toEqual([])
  })
})
