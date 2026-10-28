import { daysBetween } from '../fico/membership/membership.entity.js'

// Etapas de acompañamiento de Academica (pedido del area, 23/10/26). Cambian
// solas con el "hoy": los primeros 7 dias desde el registro son de bienvenida,
// los ultimos 10 antes de vencer son de por vencer y lo de en medio, seguimiento.
// Ojo: son otras ventanas que las de FICO (aviso de renovacion a 30 dias).
export const WELCOME_DAYS = 7
export const EXPIRING_NOTICE_DAYS = 10

// Dia 0..6 desde el registro = bienvenida; el dia del vencimiento (0) aun es
// por vencer porque el socio conserva el beneficio hasta esa fecha.
export function academicStage ({ daysSinceStart, daysToExpiry }) {
  if (daysToExpiry <= EXPIRING_NOTICE_DAYS) return 'expiring'
  if (daysSinceStart < WELCOME_DAYS) return 'welcome'
  return 'followup'
}

// Checks de acompañamiento por etapa (pedido del area, 26/10/26): uno por cada
// dia de la bienvenida (S1..S7), uno por cada mes de la membresia (M1..M12) y
// uno de renovacion cuando esta por vencer (R1).
const series = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)
const CHECKPOINTS_BY_STAGE = {
  welcome: series('S', WELCOME_DAYS),
  followup: series('M', 12),
  expiring: ['R1']
}
export const CHECKPOINTS = Object.values(CHECKPOINTS_BY_STAGE).flat()

// Gold y Plus llevan menos acompañamiento (pedido del area, 27/10/26). Los demas
// tiers (Black, Platinum) siguen con el set completo de arriba.
const CHECKPOINTS_BY_TIER = {
  'WE GOLD': { welcome: series('S', 3), followup: series('M', 3), expiring: ['R1'] },
  'WE PLUS': { welcome: ['S1'], followup: series('M', 2), expiring: ['R1'] }
}

export function checkpointsFor (stage, tier) {
  return (CHECKPOINTS_BY_TIER[tier] || CHECKPOINTS_BY_STAGE)[stage] || []
}

// Pega a cada socio los checks de su etapa (checkpoints) y los ya marcados de SU
// membresia vigente (checks). La pantalla solo pinta checkpoints: la regla vive aqui.
export function withChecks (items, checkRows) {
  const byEnrollment = new Map()
  for (const r of checkRows) byEnrollment.set(r.enrollment_id, [...(byEnrollment.get(r.enrollment_id) || []), r.checkpoint])
  return items.map(i => ({ ...i, checkpoints: checkpointsFor(i.status, i.tier), checks: byEnrollment.get(i.enrollment_id) || [] }))
}

// Academica solo atiende a socios que todavia tienen beneficio: las vencidas son
// de FICO (llama para renovar o retira), asi que aqui no se listan ni se cuentan.
// Recibe la salida de buildMembershipExpiries y reemplaza su status (ventana de
// FICO) por la etapa de Academica.
export function currentMembers ({ today, items }) {
  const current = items
    .filter(i => i.days_to_expiry >= 0)
    .map(i => ({
      ...i,
      status: academicStage({ daysSinceStart: daysBetween(i.start_date, today), daysToExpiry: i.days_to_expiry })
    }))
  const count = (pred) => current.filter(pred).length
  return {
    today,
    items: current,
    kpis: {
      total: current.length,
      welcome: count(i => i.status === 'welcome'),
      followup: count(i => i.status === 'followup'),
      expiring: count(i => i.status === 'expiring'),
      renewed: count(i => i.renewals > 0)
    }
  }
}
