// src/app.js
import 'dotenv/config' 

import path from 'path' // <--- 1. IMPORTAR PATH
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static' // <--- 2. IMPORTAR STATIC
import fastifyMultipart from '@fastify/multipart' // <--- 3. IMPORTAR MULTIPART

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

const app = Fastify({
  logger: true,
  ajv: { customOptions: { allowUnionTypes: true } }
})

// --- REGISTRO DE PLUGINS ---

// 4. REGISTRAR MULTIPART (Vital para recibir archivos)
await app.register(fastifyMultipart, {
  limits: {
    // 30 MB (ajusta este número según lo que necesites)
    fileSize: 30 * 1024 * 1024, 
    
    // Opcionales (buenos para seguridad):
    files: 5, // Máximo 5 archivos por request
  }
})

await app.register(cors, { origin: true, credentials: true })

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

app.get('/health', async () => ({ ok: true }))

// --- CONFIGURACIÓN DE ARCHIVOS ESTÁTICOS (SOLO DESARROLLO) ---
// En producción, Caddy/Nginx se encargan de esto.
if (process.env.NODE_ENV !== 'production') {
  console.log('Modo Desarrollo: Sirviendo /uploads desde Node.js');
  
  app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'uploads'),
    prefix: '/uploads/', // accesible en http://localhost:8082/uploads/
    decorateReply: false // Evita conflictos si registras static multiples veces
  });
  
}

const PORT = process.env.PORT || 8082
const HOST = process.env.HOST || '0.0.0.0'

app.listen({ port: PORT, host: HOST })
  .then(() => app.log.info(`API escuchando en http://${HOST}:${PORT}`))
  .catch((err) => { app.log.error(err); process.exit(1) }) // process.exit(1) para error