// src/app.js
// Entry de produccion. La construccion de la app vive en buildApp.js (testeable
// via app.inject sin abrir puertos). Aqui solo se cargan los crons por side-effect
// y se arranca el servidor.
import 'dotenv/config'
import './services/fico-mv-refresh.cron.js'
import './services/job-worker.cron.js'
import './services/tickets-sla.cron.js'
import './services/tickets-autoassign.cron.js'
import './services/daily-plan.cron.js'
import './services/lead-summary.cron.js'
import './services/fico-sheets-autosync.cron.js'
import './services/sheets-autosync.cron.js'
import './services/prediccion.cron.js'
import './services/whatsapp-handoff.cron.js'
import './services/fundacion-becas-alerts.cron.js'
import { buildApp } from './buildApp.js'
import { ensureStartupSchema } from './config/startup-schema.js'

const app = await buildApp()

// No tumba el arranque: si falla, el resto del ERP sigue y solo fallan las
// pantallas que usan esas tablas (queda en el log).
await ensureStartupSchema().catch(err => app.log.warn({ err }, 'startup-schema fallo'))

const PORT = process.env.PORT || 8082
const HOST = process.env.HOST || '0.0.0.0'

app.listen({ port: PORT, host: HOST })
  .then(() => app.log.info(`API escuchando en http://${HOST}:${PORT}`))
  .catch((err) => { app.log.error(err); process.exit(1) })
