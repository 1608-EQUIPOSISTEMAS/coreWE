import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildApp } from '../../src/buildApp.js'

// Smoke tests del wiring HTTP. NO tocan la base de datos: validan que el
// servidor se construye y que las capas transversales (JWT, gate de roles,
// validacion de schema, error handler, 404) responden como se espera. Esta es
// la red de seguridad minima para empezar a refactorizar (Fase 0).
let app

beforeAll(async () => {
  app = await buildApp({ logger: false })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('wiring HTTP (sin BD)', () => {
  it('GET /health responde 200 { ok: true }', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('ruta protegida sin token responde 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/token/list' })
    expect(res.statusCode).toBe(401)
  })

  it('ruta protegida con token de rol insuficiente responde 403', async () => {
    const token = app.jwt.sign({ id: 1, username: 'tester', roles: ['ACADEMICA'] })
    const res = await app.inject({
      method: 'GET',
      url: '/api/token/list',
      headers: { authorization: `Bearer ${token}` }
    })
    expect(res.statusCode).toBe(403)
  })

  it('body invalido contra schema responde 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {} // faltan username y password
    })
    expect(res.statusCode).toBe(400)
  })

  // Recursos de evento por edicion: rutas nuevas, sin BD.
  it('/api/edition/eventresourcesget sin token responde 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/edition/eventresourcesget',
      payload: { edition_num_id: 1 }
    })
    expect(res.statusCode).toBe(401)
  })

  it('/api/edition/eventresourcessave exige edition_num_id', async () => {
    const token = app.jwt.sign({ id: 1, username: 'tester', roles: ['ADMIN'] })
    const res = await app.inject({
      method: 'POST',
      url: '/api/edition/eventresourcessave',
      headers: { authorization: `Bearer ${token}` },
      payload: { banner_link: 'https://ejemplo/x.jpg' }
    })
    expect(res.statusCode).toBe(400)
  })

  // Documenta el comportamiento REAL de AJV en este servidor: @fastify/ajv-compiler
  // trae removeAdditional:true por defecto, asi que additionalProperties:false
  // BORRA en silencio los campos no declarados en vez de devolver 400. Verificado
  // en node_modules/@fastify/ajv-compiler/lib/default-ajv-options.js.
  //
  // Por eso el usecase tiene ademas su propia whitelist (EVENT_RESOURCE_FIELDS):
  // sin ella, un campo colado llegaria al SET del UPDATE. Es el mismo motivo por
  // el que whatsapp_link se pierde hoy en /editionupdate sin avisar.
  it('/api/edition/eventresourcessave descarta campos no declarados sin fallar', async () => {
    const token = app.jwt.sign({ id: 1, username: 'tester', roles: ['ADMIN'] })
    const res = await app.inject({
      method: 'POST',
      url: '/api/edition/eventresourcessave',
      headers: { authorization: `Bearer ${token}` },
      payload: { edition_num_id: 1, campo_inventado: 'x' }
    })
    // Sin campos validos que escribir el usecase corta antes de tocar la BD.
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ updated: 0 })
  })

  // Links del aula: la unica ruta de /edition con gate de rol propio. Si alguien
  // le quita el preHandler, Academica sigue funcionando y nadie se entera, por
  // eso el 403 se prueba explicitamente.
  it('/api/edition/classroomlinkssave rechaza un rol ajeno con 403', async () => {
    const token = app.jwt.sign({ id: 1, username: 'tester', roles: ['COMERCIAL'] })
    const res = await app.inject({
      method: 'POST',
      url: '/api/edition/classroomlinkssave',
      headers: { authorization: `Bearer ${token}` },
      payload: { edition_num_id: 1, ficha_link: 'https://x' }
    })
    expect(res.statusCode).toBe(403)
  })

  it('/api/edition/classroomlinkssave deja pasar a ACADEMICA y exige edition_num_id', async () => {
    const token = app.jwt.sign({ id: 1, username: 'tester', roles: ['ACADEMICA'] })
    const res = await app.inject({
      method: 'POST',
      url: '/api/edition/classroomlinkssave',
      headers: { authorization: `Bearer ${token}` },
      payload: { ficha_link: 'https://x' }
    })
    // 400 del schema, no 403: el rol paso el gate y se corto antes de la BD.
    expect(res.statusCode).toBe(400)
  })

  it('/api/edition/eventcategoriessave exige la lista de categorias', async () => {
    const token = app.jwt.sign({ id: 1, username: 'tester', roles: ['ADMIN'] })
    const res = await app.inject({
      method: 'POST',
      url: '/api/edition/eventcategoriessave',
      headers: { authorization: `Bearer ${token}` },
      payload: { edition_num_id: 1 }
    })
    expect(res.statusCode).toBe(400)
  })

  it('/api/edition/eventcategoriesget sin token responde 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/edition/eventcategoriesget',
      payload: { edition_num_id: 1 }
    })
    expect(res.statusCode).toBe(401)
  })

  it('ruta inexistente responde 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/no-existe-esta-ruta' })
    expect(res.statusCode).toBe(404)
  })
})

// Smoke tests que SI golpean la BD. Se omiten salvo que TEST_DB_READY=true, para
// no acoplar la suite base a una BD de test. Cuando exista una BD de test
// sembrada (usuario semilla, etc.), poner TEST_DB_READY=true y completar.
const dbReady = process.env.TEST_DB_READY === 'true'

describe.skipIf(!dbReady)('endpoints criticos (requieren BD de test)', () => {
  it('POST /api/auth/login con credenciales semilla devuelve token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: process.env.TEST_SEED_USER,
        password: process.env.TEST_SEED_PASS
      }
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()?.data?.token).toBeTruthy()
  })

  // TODO Fase 0: completar con fico/enrollmentlist, fico/enrollmentregister,
  // fico/confirmpayment, fico/confirminstallment, token/create, comercial leads.
  // Capturan el comportamiento ACTUAL (snapshot) antes de partir los god objects.
})

// Un modulo cuyas rutas nunca se registran en buildApp no rompe ningun test de
// unidad: los usecases y el repositorio siguen verdes, y el fallo aparece recien
// en la pantalla como "Route not found". Le paso al modulo b2b: sus 13
// endpoints devolvian 404 en produccion. La prueba es 401 (existe pero pide
// token) contra 404 (no existe).
describe('modulos montados en buildApp', () => {
  const rutasDeclaradas = (modulo) => {
    const url = new URL(`../../src/modules/${modulo}`, import.meta.url)
    return readFileSync(new URL(`${modulo}.routes.js`, `${url}/`), 'utf8')
      .matchAll(/fastify\.(get|post|put|delete)\('([^']+)'/g)
  }

  it.each([['b2b', '/api/b2b']])(
    'todas las rutas de %s responden algo distinto de 404', async (modulo, prefijo) => {
      const noMontadas = []
      for (const [, verbo, ruta] of rutasDeclaradas(modulo)) {
        const res = await app.inject({ method: verbo.toUpperCase(), url: `${prefijo}${ruta}`, payload: {} })
        if (res.statusCode === 404) noMontadas.push(`${verbo.toUpperCase()} ${prefijo}${ruta}`)
      }
      expect(noMontadas).toEqual([])
    })
})
