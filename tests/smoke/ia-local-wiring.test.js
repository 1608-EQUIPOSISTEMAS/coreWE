import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../../src/buildApp.js'

// Rutas de la IA local (plan del dia por area, resumen de lead, nota de
// ticket). Sin BD: auth, gates y el apagado por defecto.
let app
const token = (roles) => app.jwt.sign({ id: 1, username: 'tester', roles })

beforeAll(async () => {
  app = await buildApp({ logger: false })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('wiring IA local (sin BD)', () => {
  // Body valido: Fastify valida el schema antes del preHandler de auth.
  it.each([
    ['/api/dashboard/daily-plan', {}],
    ['/api/dashboard/daily-plan/regenerate', {}],
    ['/api/comercial/leadsummary', { id: 1 }],
    ['/api/tickets/ai-note', { ticket_id: 1 }],
    ['/api/edition/classroomgradesobservations/start', { edition_id: 1 }],
    ['/api/edition/reportrecommendations/start', { snapshot: {} }],
    ['/api/edition/aijobstatus', { job_id: 'x' }]
  ])('%s sin token responde 401', async (url, payload) => {
    const res = await app.inject({ method: 'POST', url, payload })
    expect(res.statusCode).toBe(401)
  })

  it('un colaborador no puede regenerar el plan (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/dashboard/daily-plan/regenerate',
      headers: { authorization: `Bearer ${token(['FICO'])}` },
      payload: {}
    })
    expect(res.statusCode).toBe(403)
  })

  it('view_as fuera del organigrama es 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/dashboard/daily-plan',
      headers: { authorization: `Bearer ${token(['ADMIN'])}` },
      payload: { view_as: 'toString' }
    })
    expect(res.statusCode).toBe(400)
  })

  it('resumen de lead con la IA apagada responde "apagado" sin tocar la BD', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/comercial/leadsummary',
      headers: { authorization: `Bearer ${token(['ADMIN'])}` },
      payload: { id: 1 }
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ estado: 'apagado' })
  })

  it('nota de ticket exige ticket_id (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tickets/ai-note',
      headers: { authorization: `Bearer ${token(['ADMIN'])}` },
      payload: {}
    })
    expect(res.statusCode).toBe(400)
  })

  it('estado de un trabajo IA inexistente = no_encontrado (sin BD ni IA)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/edition/aijobstatus',
      headers: { authorization: `Bearer ${token(['ACADEMICA'])}` },
      payload: { job_id: 'no-existe' }
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ job_id: 'no-existe', estado: 'no_encontrado' })
  })

  it('arrancar observaciones exige edition_id entero (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/edition/classroomgradesobservations/start',
      headers: { authorization: `Bearer ${token(['ACADEMICA'])}` },
      payload: { edition_id: 'abc' }
    })
    expect(res.statusCode).toBe(400)
  })
})
