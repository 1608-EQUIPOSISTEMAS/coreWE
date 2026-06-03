import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import ficoRoutes from '../../src/modules/fico/fico.routes.js'

// Verifica que el agregador FICO (9 subdominios) se cargue y registre como un
// grafo sano ANTES del cutover: sin imports circulares que exploten, sin
// colisiones de ruta entre subdominios, y con el preHandler de auth activo.
// No toca BD: solo ejercita el wiring de rutas.
describe('FICO aggregator wiring (sin BD)', () => {
  it('registra los 9 subdominios bajo /api/fico sin colisiones', async () => {
    const app = Fastify({ logger: false })
    await app.register(ficoRoutes, { prefix: '/api/fico' })
    await app.ready()

    const tree = app.printRoutes({ commonPrefix: false })
    for (const path of ['enrollmentlist', 'confirmpayment', 'confirminstallment', 'membershipactivationdate', 'validations', 'enrollinodoo', 'sendconfirmationemail', 'auditlog', 'classroomexport']) {
      expect(tree).toContain(path)
    }

    await app.close()
  })

  it('un endpoint autenticado sin token responde 401 (auth cableada)', async () => {
    const app = Fastify({ logger: false })
    await app.register(ficoRoutes, { prefix: '/api/fico' })
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/api/fico/bankaccounts' })
    expect(res.statusCode).toBe(401)

    await app.close()
  })
})
