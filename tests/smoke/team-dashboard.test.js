import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../../src/buildApp.js'

// El panel de equipo depende de una cosa que ningun test unitario cubre: que el
// alcance salga del TOKEN y no del cuerpo. Si manana alguien agrega un campo al
// schema para "poder filtrar por area", un colaborador podria auditar a otro
// equipo escribiendo un JSON a mano. Esto lo atrapa.
//
// Toca la BD (a diferencia de http-wiring.test.js) porque el valor de la prueba
// esta justo en que el alcance llegue hasta el SQL.
let app

beforeAll(async () => {
  app = await buildApp({ logger: false })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

const pedirPanel = (claims, body = {}) => app.inject({
  method: 'POST',
  url: '/api/dashboard/team-summary',
  headers: { authorization: `Bearer ${app.jwt.sign(claims)}` },
  payload: body
})

describe('POST /api/dashboard/team-summary', () => {
  it('sin token responde 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/dashboard/team-summary', payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('un lider recibe su area y mas de una persona', async () => {
    const res = await pedirPanel({ id: 1, username: 'lider', roles: ['LIDER_COMERCIAL'] })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.scope).toEqual({ area: 'Comercial', isLeader: true })
    expect(data.equipo.length).toBeGreaterThan(1)
  })

  it('un colaborador solo se ve a si mismo', async () => {
    const res = await pedirPanel({ id: 2, username: 'asesor', roles: ['COMERCIAL'] })
    const { data } = res.json()
    expect(data.scope.isLeader).toBe(false)
    expect(data.equipo).toHaveLength(1)
    expect(data.equipo[0].user_id).toBe(2)
  })

  // El corazon del asunto: el cuerpo no puede ampliar el alcance.
  //
  // No espera un 400: Fastify corre AJV con removeAdditional, asi que los campos
  // de mas se BORRAN en silencio en vez de rechazarse. Lo que se afirma es lo
  // que de verdad importa -- que la respuesta siga siendo la del colaborador.
  it('un colaborador no amplia su alcance escribiendolo en el body', async () => {
    const res = await pedirPanel(
      { id: 2, username: 'asesor', roles: ['COMERCIAL'] },
      { areaRoles: ['FICO'], userId: null, roles: ['ADMIN'] }
    )
    const { data } = res.json()
    expect(data.scope).toEqual({ area: 'Mi actividad', isLeader: false })
    expect(data.equipo).toHaveLength(1)
    expect(data.equipo[0].user_id).toBe(2)
  })
})
