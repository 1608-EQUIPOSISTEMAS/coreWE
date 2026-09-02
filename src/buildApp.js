// src/buildApp.js
import 'dotenv/config'
import path from 'path'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fastifyMultipart from '@fastify/multipart'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import fastifyJwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'

import catalogRoutes from './modules/catalog/catalog.routes.js'
import comercialRoutes from './modules/comercial/comercial.routes.js'
import programRoutes from './modules/program/program.routes.js'
import programDiscounts from './modules/discount/discount.routes.js'
import instructorRoutes from './modules/instructor/instructor.routes.js'
import editionRoutes from './modules/edition/edition.routes.js'
import schedulePlanRoutes from './modules/scheduleplan/scheduleplan.routes.js'
import customerRoutes from './modules/customer/customer.routes.js'
import authRoutes from './modules/auth/auth.routes.js'
import dashboardRoutes from './modules/dashboard/dashboard.routes.js'
import integrationRoutes from './modules/integration/integration.routes.js'
import uploadRoutes from './routes/upload.js'
import ficoRoutes from './modules/fico/fico.routes.js' // FSD: 9 subdominios + composition root (fico.bootstrap). Legacy fico.service.js retirado; verificar dinero en staging.
import webhookRoutes from './routes/webhooks.js'
import notificationRoutes from './modules/notification/notification.routes.js'
import tokenRoutes from './modules/fico/tokens/token.routes.js'
import botRoutes from './modules/bot/bot.routes.js'
import configRoutes from './modules/config/config.routes.js'
import auditRoutes from './modules/audit/audit.routes.js'
import importerRoutes from './modules/importer/importer.routes.js'
import marketingRoutes from './modules/marketing/marketing.routes.js'
import b2bRoutes from './modules/b2b/b2b.routes.js'
import reprogramacionRoutes from './modules/reprogramacion/reprogramacion.routes.js'
import { setImporterPorts } from './modules/importer/importer.ports.js'
import { ficoEnrollmentRegister } from './modules/fico/enrollment/enrollment.usecases.js'
import { enrollmentRepository } from './modules/fico/enrollment/enrollment.repository.js'
import { getCatalog } from './modules/catalog/catalog.usecases.js'
import { listProgramVersions } from './modules/program/program.usecases.js'
import { setIntegrationPorts } from './modules/comercial/comercial.usecases.js'
import { sendEnrollmentWebToSlack, syncEnrollmentToSheet } from './modules/integration/integration.usecases.js'

// Composition root: cablea los efectos cross-modulo que un modulo no puede
// resolver por si mismo. comercial dispara notificaciones de integration
// (Slack/Sheets) tras una inscripcion; aqui se satisface ese contrato sin que
// comercial dependa de los internals de integration (regla de aislamiento Fase 4).
setIntegrationPorts({ sendEnrollmentWebToSlack, syncEnrollmentToSheet })

// El modulo de importacion masiva (Administracion) registra inscripciones y
// resuelve nombres->IDs leyendo catalogos/programas de otros modulos. Aqui se
// le inyectan esos puertos sin que importer dependa de sus internals.
setImporterPorts({
  registerEnrollment: ficoEnrollmentRegister,
  getCatalog,
  listProgramVersions,
  listEditionsByVersion: (programVersionId) => enrollmentRepository.listEditionsByVersion(programVersionId),
  // Todas las ediciones activas en una query; la hoja FICO la indexa por
  // (version_code, global_code) y resuelve la columna ED en memoria.
  listActiveEditions: () => enrollmentRepository.listActiveEditions(),
  // Versiones de programas-membresia (WE BLACK/GOLD/...) para crear la
  // inscripcion de membresia desde la columna J de la hoja.
  listMembershipVersions: () => enrollmentRepository.listMembershipVersions(),
  // Asesores (alias -> user_id) y actualizacion de agente al re-importar.
  listAgents: () => enrollmentRepository.listAgents(),
  updateEnrollmentAgent: ({ enrollmentId, sellerAgentId, agentOrigin }) =>
    enrollmentRepository.updateEnrollmentAgent(enrollmentId, sellerAgentId, agentOrigin),
  // Estructura padre->aulas hijas, para crear inscripciones hijas de paquete.
  listEditionStructure: () => enrollmentRepository.listEditionStructure(),
  // Cuentas bancarias y monedas, para resolver "ENTIDAD FINANCIERA" y "TIPO DE
  // MONEDA" de la hoja FICO.
  listBankAccounts: () => enrollmentRepository.bankAccountList(),
  listCurrencies: () => enrollmentRepository.currencyList()
})

// Construye y configura la instancia Fastify sin arrancarla. Permite levantar
// el servidor en produccion (server entry) y, sobre todo, hacer app.inject() en
// tests sin abrir puertos ni cargar los crons. Los crons y app.listen viven en
// el entry (app.js), no aqui.
export async function buildApp (opts = {}) {
  const app = Fastify({
    logger: opts.logger ?? true,
    ajv: { customOptions: { allowUnionTypes: true } },
    trustProxy: true
  })

  // --- 1. CORS Y RATE LIMIT ---
  const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  await app.register(cors, {
    origin (origin, cb) {
      // Peticiones server-to-server / curl / health (sin header Origin)
      if (!origin) return cb(null, true)
      // En desarrollo se permite cualquier origen para no bloquear el flow local
      if (process.env.NODE_ENV !== 'production') return cb(null, true)
      if (corsOrigins.includes(origin)) return cb(null, true)
      return cb(new Error(`Origin no permitido por CORS: ${origin}`), false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  })

  await app.register(rateLimit, {
    global: true,
    max: 20,
    timeWindow: 1000,
    allowList: ['127.0.0.1', 'localhost'],
    errorResponseBuilder: function (request, context) {
      return {
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Cálmate un poco. Has excedido el límite de peticiones. Intenta en ${context.after} segundos.`
      }
    }
  })

  // --- 2. MULTIPART ---
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 30 * 1024 * 1024,
      files: 5
    }
  })

  // --- 3. SWAGGER ---
  // Swagger UI revela la estructura completa del API. En produccion solo se
  // expone cuando SWAGGER_ENABLED=true. En desarrollo siempre esta disponible.
  const swaggerEnabled = process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true'

  if (swaggerEnabled) {
    await app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'Mi API del Sistema',
          description: 'Documentación interactiva de todos los módulos',
          version: '1.0.0'
        },
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT'
            }
          }
        },
        security: [{ bearerAuth: [] }]
      }
    })

    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: false
      }
    })
  }

  // --- 4. JWT Y AUTENTICACIÓN ---
  const JWT_SECRET = process.env.JWT_SECRET
  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error(
      'JWT_SECRET es obligatorio y debe tener al menos 32 caracteres. ' +
      'Define la variable en .env antes de arrancar el servidor.'
    )
  }
  await app.register(fastifyJwt, { secret: JWT_SECRET })

  // Decorador para proteger rutas (en caso de que lo uses directo en app)
  app.decorate('authenticate', async function (request, reply) {
    try {
      // SSE usa EventSource que no puede poner headers,
      // así que acepta el token también desde ?token=
      if (request.query.token) {
        request.headers.authorization = `Bearer ${request.query.token}`
      }
      await request.jwtVerify()
    } catch (err) {
      reply.code(401).send({
        message: 'Token inválido o expirado',
        error: err.message
      })
    }
  })

  // Evita que Fastify cierre las conexiones SSE automáticamente
  app.addContentTypeParser('text/event-stream', (req, payload, done) => done(null, payload))

  // --- 5. RUTAS ---
  await app.register(catalogRoutes, { prefix: '/api/catalog' })
  await app.register(comercialRoutes, { prefix: '/api/comercial' })
  await app.register(programRoutes, { prefix: '/api/program' })
  await app.register(programDiscounts, { prefix: '/api/discount' })
  await app.register(instructorRoutes, { prefix: '/api/instructor' })
  await app.register(editionRoutes, { prefix: '/api/edition' })
  await app.register(schedulePlanRoutes, { prefix: '/api/scheduleplan' })
  await app.register(customerRoutes, { prefix: '/api/customer' })
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(integrationRoutes, { prefix: '/api/integration' })
  await app.register(ficoRoutes, { prefix: '/api/fico' })
  await app.register(webhookRoutes, { prefix: '/api/webhooks' })
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' })
  await app.register(uploadRoutes, { prefix: '/api/upload' })
  await app.register(notificationRoutes, { prefix: '/api' })
  await app.register(tokenRoutes, { prefix: '/api/token' })
  await app.register(botRoutes, { prefix: '/api/bot' })
  await app.register(configRoutes, { prefix: '/api/config' })
  await app.register(auditRoutes, { prefix: '/api/audit' })
  await app.register(importerRoutes, { prefix: '/api/import' })
  await app.register(marketingRoutes, { prefix: '/api/marketing' })
  await app.register(b2bRoutes, { prefix: '/api/b2b' })
  await app.register(reprogramacionRoutes, { prefix: '/api/reprogramacion' })

  app.get('/health', async () => ({ ok: true }))

  // Defensa en profundidad: cualquier error no manejado pasa por aqui. En produccion
  // no devolvemos stack ni mensajes internos. El log interno conserva todo para debug.
  app.setErrorHandler((err, request, reply) => {
    const status = err.statusCode || err.validation ? (err.statusCode || 400) : 500
    request.log.error({ err, reqId: request.id, userId: request.user?.id }, 'Unhandled error')

    // Las rutas legacy devolvian la clave 'error'; los modulos nuevos delegan
    // en este handler. Se emiten 'message' y 'error' juntas para no romper a
    // clientes que leen cualquiera de las dos durante la migracion.
    if (err.validation) {
      return reply.code(400).send({ ok: false, message: 'Datos invalidos', error: 'Datos invalidos', details: err.validation })
    }

    if (status >= 500 && process.env.NODE_ENV === 'production' && !err.expose) {
      return reply.code(status).send({ ok: false, message: 'Error interno del servidor', error: 'Error interno del servidor' })
    }

    const msg = err.message || 'Error'
    return reply.code(status).send({ ok: false, message: msg, error: msg })
  })

  // --- 6. ARCHIVOS ESTÁTICOS ---
  if (process.env.NODE_ENV !== 'production') {
    app.register(fastifyStatic, {
      root: path.join(process.cwd(), 'uploads'),
      prefix: '/uploads/',
      decorateReply: false
    })
  }

  return app
}

export default buildApp
