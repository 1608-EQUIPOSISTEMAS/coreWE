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
