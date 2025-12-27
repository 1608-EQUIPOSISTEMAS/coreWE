// src/app.js
import 'dotenv/config' 

import path from 'path' 
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static' 
import fastifyMultipart from '@fastify/multipart' 

import catalogRoutes from './routes/catalog.js'
import comercialRoutes from './routes/comercial.js'
import programRoutes from './routes/program.js'
import programDiscounts from './routes/discount.js'
import instructorRoutes from './routes/instructor.js'
import editionRoutes from './routes/edition.js'
import customerRoutes from './routes/customer.js'
import authRoutes from './routes/auth.js'
import corporateAgreementRoutes from './routes/corporate_agreement.js'  
import integrationRoutes from './routes/integration.js'
import fastifyJwt from '@fastify/jwt'
// 1. IMPORTAR LA NUEVA RUTA AQUÍ (AGREGAR ESTA LÍNEA)
import uploadRoutes from './routes/upload.js' 

const app = Fastify({
  logger: true,
  ajv: { customOptions: { allowUnionTypes: true } }
})

// --- REGISTRO DE PLUGINS ---
await app.register(fastifyMultipart, {
  limits: {
    fileSize: 30 * 1024 * 1024, 
    files: 5, 
  }
})

await app.register(cors, { origin: true, credentials: true })


// -----------------------------------------------------
// 1. REGISTRAR JWT Y EL DECORADOR (AGREGAR ESTO AQUÍ)
// -----------------------------------------------------
await app.register(fastifyJwt, {
  secret: process.env.JWT_SECRET || 'mi_secreto_super_seguro_cambialo' // Usa variable de entorno idealmente
})

// Decorador para proteger rutas
app.decorate('authenticate', async function (request, reply) {
  try {
    await request.jwtVerify()
  } catch (err) {
    reply.send(err)
  }
})

// --- REGISTRO DE RUTAS ---
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

// 2. REGISTRAR LA RUTA AQUÍ (AGREGAR ESTA LÍNEA)
// Esto habilitará el endpoint: POST http://tudominio/api/upload
await app.register(uploadRoutes,    { prefix: '/api/upload' }) 


app.get('/health', async () => ({ ok: true }))

// --- CONFIGURACIÓN DE ARCHIVOS ESTÁTICOS ---
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