// Plan del dia con IA (Comercial + areas de AI_DAILY_PLAN_AREAS). Ver modules/dashboard/daily-plan.
//
// Corre a las 6:30 (Lima) de lunes a sabado: el modelo local es lento en CPU,
// asi que el plan se arma antes de que llegue el equipo y el panel solo lo lee.
// Si el backend arranca despues de esa hora y hoy aun no hay plan (deploy,
// reinicio), lo genera al arrancar.
//
// APAGADO por defecto: se enciende con AI_DAILY_PLAN_ENABLED=true (solo en el
// docker-compose de produccion). Asi un backend local conectado por tunel no
// genera planes por su cuenta; y si lo hiciera, el advisory lock evita que dos
// procesos corran a la vez.

import cron from 'node-cron'
import { startDailyPlanGeneration } from '../modules/dashboard/daily-plan/daily-plan.usecases.js'
import { hasPlanForToday } from '../modules/dashboard/daily-plan/daily-plan.repository.js'
import { enabledAreas } from '../modules/dashboard/daily-plan/area-plan.entity.js'

const SCHEDULE = '30 6 * * 1-6'
const TZ = 'America/Lima'
const CATCH_UP_DELAY_MS = 60 * 1000

async function catchUp () {
  try {
    const horaLima = Number(new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }))
    const domingo = new Date().toLocaleString('en-US', { timeZone: TZ, weekday: 'short' }) === 'Sun'
    if (domingo || horaLima < 6 || horaLima >= 20) return
    // Basta con que falte UN area encendida para generar (solo esas).
    const faltan = []
    for (const area of enabledAreas()) if (!(await hasPlanForToday(area))) faltan.push(area)
    if (!faltan.length) return
    console.log('[daily-plan] sin plan de hoy: generando al arrancar')
    startDailyPlanGeneration({ areas: faltan })
  } catch (err) {
    console.error('[daily-plan] catch-up fallo:', err.message)
  }
}

if (process.env.AI_DAILY_PLAN_ENABLED === 'true') {
  cron.schedule(SCHEDULE, () => startDailyPlanGeneration(), { timezone: TZ })
  setTimeout(catchUp, CATCH_UP_DELAY_MS)
  console.log(`[daily-plan] Programado '${SCHEDULE}' (TZ ${TZ})`)
} else {
  console.log('[daily-plan] apagado (AI_DAILY_PLAN_ENABLED != true)')
}
