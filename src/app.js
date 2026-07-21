// src/app.js
// Entry de produccion. La construccion de la app vive en buildApp.js (testeable
// via app.inject sin abrir puertos). Aqui solo se cargan los crons por side-effect
// y se arranca el servidor.
import 'dotenv/config'
import './services/fico-mv-refresh.cron.js'
import './services/job-worker.cron.js'
import './services/social-sync.cron.js'
import { buildApp } from './buildApp.js'

const app = await buildApp()

const PORT = process.env.PORT || 8082
const HOST = process.env.HOST || '0.0.0.0'

app.listen({ port: PORT, host: HOST })
  .then(() => app.log.info(`API escuchando en http://${HOST}:${PORT}`))
  .catch((err) => { app.log.error(err); process.exit(1) })
