// Bot de WhatsApp: deriva a la asesora las conversaciones que llegan a la hora
// 71 de su ventana gratis (ver modules/whatsapp). Cada 5 min: la plantilla debe
// salir antes de la hora 72, así que el margen es de una hora.
//
// APAGADO por defecto: se enciende con WHATSAPP_BOT_ENABLED=true. Así un
// backend local apuntado a otra BD no le escribe a leads reales; y si dos
// procesos corren a la vez, claimHandoff (UPDATE atómico) evita el doble envío.

import cron from 'node-cron'
import { runDueHandoffs } from '../modules/whatsapp/whatsapp.usecases.js'

const SCHEDULE = '*/5 * * * *'

if (process.env.WHATSAPP_BOT_ENABLED === 'true') {
  cron.schedule(SCHEDULE, async () => {
    try {
      const { due, sent } = await runDueHandoffs()
      if (due) console.log(`[whatsapp-handoff] ${sent}/${due} derivaciones enviadas`)
    } catch (err) {
      console.error('[whatsapp-handoff] falló:', err.message)
    }
  })
  console.log(`[whatsapp-handoff] Programado '${SCHEDULE}'`)
} else {
  console.log('[whatsapp-handoff] apagado (WHATSAPP_BOT_ENABLED != true)')
}
