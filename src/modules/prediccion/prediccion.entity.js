// Predictividad Comercial: reglas puras de la ficha del cliente.
//
// La probabilidad que ve el asesor es una TASA HISTORICA de un grupo real
// ("de 1245 que consultaron este programa, 7.7% lo compro en 4 meses"), nunca
// un numero inventado: con una base de conversion de ~10%, un "80%" sin
// respaldo quema la confianza del equipo en la primera semana.

// Debajo de esto la tasa es ruido: 2 de 5 no es "40%".
export const MIN_SAMPLE = 30

// Piso de la sugerencia = conversion base de una consulta en vivo (TOP 7.4%,
// BAJO 8.4%, NORMAL 9.3%; 15/10/26). Debajo, "sugerir" no le dice al asesor
// nada mejor que llamar a cualquier consulta (decision del usuario).
export const MIN_PROBABILITY = 8

// Ventana en la que una consulta "se convierte" (p90 del primer contacto a la
// compra = 118 dias, medido 15/10/26).
export const CONVERSION_WINDOW_DAYS = 120

// Orden de la lista = probabilidad x valor de la venta. Factor = ticket promedio
// del nivel / ticket TOP (S/ 733), en vivo + presencial desde dic-25, medido el
// 15/10/26 y aprobado por el usuario. TOP convierte MENOS (7.4%) pero vale el
// doble: ordenar solo por probabilidad mandaria al equipo a vender lo barato.
// NUEVO no tiene historia, asi que nunca junta MIN_SAMPLE y no llega a la lista.
export const TIER_FACTOR = { TOP: 1, NORMAL: 0.57, BAJO: 0.5 }

const MAX_SUGGESTIONS = 5

const isPurchase = (event) => event.event_type === 'COMPRA'

const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

export function summarizeHistory (history, today) {
  const purchases = history.filter(isPurchase)
  const dates = history.map((e) => e.event_date).sort()
  const last = dates.at(-1) ?? null
  return {
    consultas: history.length - purchases.length,
    compras: purchases.length,
    // Solo el ERP trae monto; el legacy dice que compro, no cuanto.
    monto_erp: purchases.reduce((sum, e) => sum + Number(e.amount ?? 0), 0),
    primera_fecha: dates[0] ?? null,
    ultima_fecha: last,
    dias_desde_ultima: last ? daysBetween(last, today) : null,
    es_cliente: purchases.length > 0
  }
}

// Fechas como texto YYYY-MM-DD: nunca new Date(), que en Lima corre el dia.
const toDayMonthYear = (isoDate) => isoDate.split('-').reverse().join('/')

const pct = (part, total) => Math.round((1000 * part) / total) / 10

function fromInquiries ({ inquiries, consulted }) {
  return inquiries.map((r) => ({
    program_id: r.program_id,
    probability: pct(r.compraron, r.consultaron),
    sample: r.consultaron,
    reason: `Consultó el ${toDayMonthYear(consulted.get(r.program_id))}. De ${r.consultaron} personas que consultaron este programa, ` +
      `${pct(r.compraron, r.consultaron)}% lo compró en los ${CONVERSION_WINDOW_DAYS} días siguientes.`
  }))
}

function fromCoPurchases ({ coPurchases, programName }) {
  return coPurchases.map((r) => ({
    program_id: r.to_program,
    probability: pct(r.next_buyers, r.buyers),
    sample: r.buyers,
    reason: `De ${r.buyers} personas que compraron ${programName(r.from_program)}, ` +
      `${pct(r.next_buyers, r.buyers)}% compró este programa después.`
  }))
}

// Un programa puede salir por las dos vias (lo consulto y ademas es la compra
// tipica despues de lo que ya tiene): se queda la razon con mayor probabilidad.
function bestPerProgram (candidates) {
  const best = new Map()
  for (const c of candidates) {
    const current = best.get(c.program_id)
    if (!current || c.probability > current.probability) best.set(c.program_id, c)
  }
  return [...best.values()]
}

export function buildSuggestions ({ history, inquiries, coPurchases, programs }) {
  const byId = new Map(programs.map((p) => [p.program_id, p]))
  const programName = (id) => byId.get(id)?.program_name ?? `programa ${id}`
  const bought = new Set(history.filter(isPurchase).map((e) => e.program_id))
  const consulted = new Map()
  for (const e of history) {
    if (!isPurchase(e) && e.program_id && (!consulted.has(e.program_id) || e.event_date > consulted.get(e.program_id))) {
      consulted.set(e.program_id, e.event_date)
    }
  }

  const candidates = [
    ...fromInquiries({ inquiries: inquiries.filter((r) => consulted.has(r.program_id)), consulted }),
    ...fromCoPurchases({ coPurchases, programName })
  ].filter((c) => c.sample >= MIN_SAMPLE && c.probability >= MIN_PROBABILITY && !bought.has(c.program_id) && byId.get(c.program_id)?.suggestable)

  return bestPerProgram(candidates)
    .map((c) => {
      const tier = byId.get(c.program_id).tier ?? 'BAJO'
      return { ...c, program_name: programName(c.program_id), tier, rank: c.probability * (TIER_FACTOR[tier] ?? TIER_FACTOR.BAJO) }
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ rank, ...suggestion }) => suggestion)
}

// Lo que el cliente PIDIO va primero y sin piso de probabilidad: preguntar dos
// veces por un programa es la senal mas clara de que lo quiere. El piso de 8% es
// para lo que el sistema adivina, no para lo que el cliente dijo.
const MAX_REQUESTED = 2

function requestedPrograms ({ history, byId, bought, conversion }) {
  const asked = new Map()
  for (const e of history) {
    if (isPurchase(e) || !e.program_id || bought.has(e.program_id) || !byId.get(e.program_id)?.suggestable) continue
    const seen = asked.get(e.program_id) ?? { times: 0, last: e.event_date }
    asked.set(e.program_id, { times: seen.times + 1, last: e.event_date > seen.last ? e.event_date : seen.last })
  }
  return [...asked.entries()]
    .sort(([, a], [, b]) => b.last.localeCompare(a.last))
    .slice(0, MAX_REQUESTED)
    .map(([programId, { times, last }]) => {
      const c = conversion.get(programId)
      const backed = c && c.consultaron >= MIN_SAMPLE
      return {
        kind: 'PIDIO',
        program_id: programId,
        program_name: byId.get(programId).program_name,
        tier: byId.get(programId).tier ?? 'BAJO',
        probability: backed ? pct(c.compraron, c.consultaron) : null,
        sample: backed ? c.consultaron : null,
        reason: `Lo consultó ${times === 1 ? '1 vez' : `${times} veces`} (última: ${toDayMonthYear(last)}).` +
          (backed ? ` De ${c.consultaron} que lo consultaron, ${pct(c.compraron, c.consultaron)}% lo compró en ${CONVERSION_WINDOW_DAYS} días.` : '')
      }
    })
}

// details: { program_id, next_start, next_code, price_professional, price_student, reservation }
// (proxima edicion y precio en soles): lo que el asesor necesita para cerrar.
export function buildOffers ({ history, inquiries, coPurchases, programs, details }) {
  const byId = new Map(programs.map((p) => [p.program_id, p]))
  const bought = new Set(history.filter(isPurchase).map((e) => e.program_id))
  const conversion = new Map(inquiries.map((r) => [r.program_id, r]))
  const detailOf = new Map(details.map((d) => [d.program_id, d]))

  const requested = requestedPrograms({ history, byId, bought, conversion })
  const requestedIds = new Set(requested.map((o) => o.program_id))
  const suggested = buildSuggestions({ history, inquiries, coPurchases, programs })
    .filter((s) => !requestedIds.has(s.program_id))
    .map((s) => ({ kind: 'SUGERIDO', ...s }))

  return [...requested, ...suggested].slice(0, MAX_SUGGESTIONS)
    .map((offer) => ({ ...offer, ...offerContext(detailOf.get(offer.program_id)) }))
}

// Proxima edicion y precio en soles de un programa (fila de offerDetails), o
// null si no hay: la ficha y la bandeja los muestran igual.
export function offerContext (d) {
  return {
    edicion: d?.next_start ? { inicio: d.next_start, codigo: d.next_code } : null,
    precio: d?.price_professional
      ? { profesional: Number(d.price_professional), estudiante: Number(d.price_student), reserva: Number(d.reservation) }
      : null
  }
}
