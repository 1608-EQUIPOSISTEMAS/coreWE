// "¿Que tan probable es que compre ahora?": UNA regla para la ficha y la bandeja.
// Si cada pantalla calculara la suya, la bandeja diria 9% y la ficha nada (paso
// el 15/10/26 con el 929532343).
//
// Medido 15/10/26 (scripts/pred-2-medir-*.sql, cortes semanales ene-jul 26),
// probabilidad de comprar ALGO en los 30 dias siguientes:
//   cliente que volvio a consultar hace 15-120 dias: 4.4% (1 consulta) / 9.0% (2+)
//   prospecto que nunca compro, mismo tramo:         0.8% (1 consulta) / 1.3% (2+)
// Los primeros 14 dias son el momento de cerrar: p90 de la ultima consulta a la
// compra = 14 dias.

export const RETURNING_CLIENT_PROBABILITY = { single: 4.4, repeated: 9.0 }
export const COLD_PROSPECT_PROBABILITY = { single: 0.8, repeated: 1.3 }

export const FIRST_ELIGIBLE_DAY = 15
export const LAST_ELIGIBLE_DAY = 120

export const probabilityOfReturningClient = (inquiries) =>
  inquiries >= 2 ? RETURNING_CLIENT_PROBABILITY.repeated : RETURNING_CLIENT_PROBABILITY.single

const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

const isErpInquiry = (e) => e.source === 'ERP_LEAD'
const isPurchase = (e) => e.event_type === 'COMPRA'

// history: eventos de mv_commercial_history con event_date como texto YYYY-MM-DD.
export function purchaseOutlook (history, today) {
  const last = history.filter(isErpInquiry).sort((a, b) => b.event_date.localeCompare(a.event_date))[0]
  if (!last) return null

  const boughtSince = history.some((e) => isPurchase(e) && e.source === 'ERP_ENROLLMENT' && e.event_date >= last.event_date)
  if (boughtSince) return { segment: 'COMPRO', probability: null, days: null, inquiries: null }

  const days = daysBetween(last.event_date, today)
  const inquiries = history.filter((e) => isErpInquiry(e) && e.program_id === last.program_id && e.event_date <= last.event_date).length
  const isClient = history.some((e) => isPurchase(e) && e.event_date < last.event_date)

  if (days < FIRST_ELIGIBLE_DAY) return { segment: 'CALIENTE', probability: null, days, inquiries }
  if (days > LAST_ELIGIBLE_DAY) return { segment: 'DORMIDO', probability: null, days, inquiries }
  if (isClient) return { segment: 'VOLVIO', probability: probabilityOfReturningClient(inquiries), days, inquiries }
  return {
    segment: 'FRIO',
    probability: inquiries >= 2 ? COLD_PROSPECT_PROBABILITY.repeated : COLD_PROSPECT_PROBABILITY.single,
    days,
    inquiries
  }
}
