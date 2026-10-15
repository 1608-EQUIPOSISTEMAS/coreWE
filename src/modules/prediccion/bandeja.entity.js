// Bandeja "Llamar hoy": reglas puras de quien entra, con que probabilidad y a
// que asesor le toca. La probabilidad sale de outlook.entity.js, la misma que
// muestra la ficha: la bandeja es de RECOMPRA (cliente que volvio a consultar),
// no de prospectos frios, que casi nunca compran.
import { TIER_FACTOR } from './prediccion.entity.js'
import { probabilityOfReturningClient } from './outlook.entity.js'

export { FIRST_ELIGIBLE_DAY, LAST_ELIGIBLE_DAY } from './outlook.entity.js'

// Piso de la bandeja (decision del usuario, 15/10/26): deja entrar a todo
// cliente que volvio a consultar. Se compara contra el lead dormido (0.24%),
// no contra una consulta fresca como el piso de 8% de la ficha.
export const MIN_QUEUE_PROBABILITY = 4

// Bloqueo: el cliente queda con un asesor 14 dias. Enfriamiento: despues de
// cerrado no vuelve a la bandeja en 30 dias (nadie quiere 2 llamadas por semana).
export const LOCK_DAYS = 14
export const COOLDOWN_DAYS = 30

// ponytail: tope fijo por asesor; pasar a configuracion si los lideres lo piden.
export const MAX_OPEN_PER_ADVISOR = 20

export const OUTCOMES = ['CONTESTO', 'NO_INTERESA', 'NO_CONTESTA', 'NUMERO_ERRADO']

// Por que no compro. Obligatorio con NO_INTERESA: sin motivo no se sabe si
// volver a llamar ni con que argumento.
export const NO_BUY_REASONS = ['PRECIO', 'HORARIO', 'FECHA', 'LO_PENSARA', 'OTRO_PROGRAMA', 'COMPETENCIA', 'SIN_INTERES']

// Grupo de control: este % de clientes elegibles NO se llama. Contra ellos se
// mide si la bandeja hace vender mas (si no, el cliente igual iba a comprar).
export const CONTROL_SHARE = 15

// Sorteo FIJO por telefono (hash FNV-1a), no random() de cada dia: el cliente
// que hoy no entro por cupo no se vuelve a sortear manana, y el control queda
// en el 15% de verdad. La sal lo despega de los digitos del numero.
const CONTROL_SALT = 'pred-control-2026'
export function isControl (phoneKey) {
  let hash = 0x811c9dc5
  for (const ch of CONTROL_SALT + phoneKey) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % 100 < CONTROL_SHARE
}

// Aritmetica de fechas en UTC sobre texto YYYY-MM-DD: con getters locales Lima
// corre el dia.
export function addDays (isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function rankCandidates (candidates) {
  return candidates
    .map((c) => {
      const tier = c.tier ?? 'BAJO'
      const probability = probabilityOfReturningClient(c.inquiries)
      return { ...c, tier, probability, rank: probability * (TIER_FACTOR[tier] ?? TIER_FACTOR.BAJO) }
    })
    .filter((c) => c.probability >= MIN_QUEUE_PROBABILITY)
    .sort((a, b) => b.rank - a.rank || a.phone_key.localeCompare(b.phone_key))
}

// El control entra solo hasta donde llego el cupo de hoy: los llamados son la
// parte ALTA del ranking (hay 20 por asesor) y un control de todo el rango
// compararia mejores contra peores (lo delato la prueba A/A del 15/10/26: el
// control salia 30% en vez de 15%). Sin nadie asignado, no hay control.
export function controlWithinReach ({ control, assigned }) {
  if (!assigned.length) return []
  const cutoff = Math.min(...assigned.map((a) => a.rank))
  return control.filter((c) => c.rank >= cutoff)
}

// Reparto "en serpiente" (1..n, n..1, 1..n): cada asesor recibe una mezcla
// pareja de clientes buenos y regulares. Un round-robin simple le daria al
// primero de la lista siempre el mejor de cada vuelta.
export function distributeSnake ({ ranked, advisors, maxOpen = MAX_OPEN_PER_ADVISOR }) {
  const room = new Map(advisors.map((a) => [a.user_id, Math.max(0, maxOpen - a.open)]))
  const order = advisors.map((a) => a.user_id)
  const assigned = []
  let forward = true
  let i = 0
  while (i < ranked.length && [...room.values()].some((r) => r > 0)) {
    for (const userId of forward ? order : [...order].reverse()) {
      if (i >= ranked.length) break
      if (room.get(userId) === 0) continue
      assigned.push({ ...ranked[i++], user_id: userId })
      room.set(userId, room.get(userId) - 1)
    }
    forward = !forward
  }
  return assigned
}
