// src/app.js
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
//  import './services/crm-auto-attempts.cron.js'
import './services/fico-mv-refresh.cron.js'
import './services/job-worker.cron.js'
// Rutas
import catalogRoutes from './routes/catalog.js'
import comercialRoutes from './routes/comercial.js'
import programRoutes from './routes/program.js'
import programDiscounts from './routes/discount.js'
import instructorRoutes from './routes/instructor.js'
import editionRoutes from './routes/edition.js'
import customerRoutes from './routes/customer.js'
import authRoutes from './routes/auth.js'
import dashboardRoutes from './routes/dashboard.js'
import corporateAgreementRoutes from './routes/corporate_agreement.js'  
import integrationRoutes from './routes/integration.js'
import uploadRoutes from './routes/upload.js' 
import ficoRoutes from './routes/fico.js'
import webhookRoutes from './routes/webhooks.js'
import notificationRoutes from './routes/notifications.js'
import tokenRoutes from './routes/token.js'
import botRoutes from './routes/bot.js'

const app = Fastify({
  logger: true,
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
    files: 5, 
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
await app.register(catalogRoutes,   { prefix: '/api/catalog' })
await app.register(comercialRoutes, { prefix: '/api/comercial' })
await app.register(programRoutes,   { prefix: '/api/program' })
await app.register(programDiscounts,{ prefix: '/api/discount' })
await app.register(instructorRoutes,{ prefix: '/api/instructor' })
await app.register(editionRoutes,   { prefix: '/api/edition' })
await app.register(customerRoutes,  { prefix: '/api/customer' })
await app.register(corporateAgreementRoutes, { prefix: '/api/corporate_agreement' })
await app.register(authRoutes,      { prefix: '/api/auth' })
await app.register(integrationRoutes, { prefix: '/api/integration' })
await app.register(ficoRoutes,      { prefix: '/api/fico' })
await app.register(webhookRoutes,   { prefix: '/api/webhooks' })
await app.register(dashboardRoutes, { prefix: '/api/dashboard' })
await app.register(uploadRoutes,    { prefix: '/api/upload' }) 
await app.register(notificationRoutes, { prefix: '/api' })
await app.register(tokenRoutes,        { prefix: '/api/token' })
await app.register(botRoutes,          { prefix: '/api/bot' })



app.get('/health', async () => ({ ok: true }))

// Defensa en profundidad: cualquier error no manejado pasa por aqui. En produccion
// no devolvemos stack ni mensajes internos. El log interno conserva todo para debug.
app.setErrorHandler((err, request, reply) => {
  const status = err.statusCode || err.validation ? (err.statusCode || 400) : 500
  request.log.error({ err, reqId: request.id, userId: request.user?.id }, 'Unhandled error')

  if (err.validation) {
    return reply.code(400).send({ ok: false, message: 'Datos invalidos', details: err.validation })
  }

  if (status >= 500 && process.env.NODE_ENV === 'production') {
    return reply.code(status).send({ ok: false, message: 'Error interno del servidor' })
  }

  return reply.code(status).send({ ok: false, message: err.message || 'Error' })
})

// --- 6. ARCHIVOS ESTÁTICOS ---
if (process.env.NODE_ENV !== 'production') {
  console.log('Modo Desarrollo: Sirviendo /uploads desde Node.js');
  app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'uploads'),
    prefix: '/uploads/', 
    decorateReply: false 
  });
}

const PORT = process.env.PORT || 8082
const HOST = process.env.HOST || '0.0.0.0'

app.listen({ port: PORT, host: HOST })
  .then(() => app.log.info(`API escuchando en http://${HOST}:${PORT}`))
  .catch((err) => { app.log.error(err); process.exit(1) })