// Bandeja "Llamar hoy": reglas puras de quien entra, en que nivel y a que asesor
// le toca. El nivel sale de outlook.entity.js, el mismo que muestra la ficha.
// Entran ALTA y MEDIA (frescos de 14 dias o clientes que volvieron); el nuevo
// con 1 consulta (BAJA) no se llama: va a la cadencia de WhatsApp.
import { TIER_FACTOR } from './prediccion.entity.js'
import { levelOf, isCallable, expectedProbability, FIRST_ELIGIBLE_DAY } from './outlook.entity.js'

export { FIRST_ELIGIBLE_DAY, LAST_ELIGIBLE_DAY } from './outlook.entity.js'

// Bloqueo: el cliente queda con un asesor 14 dias. Enfriamiento: despues de
// cerrado no vuelve a la bandeja en 30 dias (nadie quiere 2 llamadas por semana).
export const LOCK_DAYS = 14
export const COOLDOWN_DAYS = 30

// ponytail: tope fijo por asesor; pasar a configuracion si los lideres lo piden.
export const MAX_OPEN_PER_ADVISOR = 20

// Lo que registra el asesor. Los que cierran sacan al cliente de la bandeja; los
// otros lo reprograman (nextStep).
export const OUTCOMES = ['INSCRITO', 'LO_PIENSO', 'CARO', 'NO_CONTESTA', 'OTRO_PROGRAMA', 'NO_INTERESA', 'NUMERO_ERRADO']
const CLOSING_OUTCOMES = ['INSCRITO', 'OTRO_PROGRAMA', 'NO_INTERESA', 'NUMERO_ERRADO']
// Al tercer "no contesta" se deja de llamar: pasa a la cadencia de WhatsApp.
export const MAX_ATTEMPTS = 3
const THINK_IT_OVER_DAYS = 3

// Que pasa con la asignacion despues de un resultado.
export function nextStep ({ outcome, attempts, today }) {
  if (CLOSING_OUTCOMES.includes(outcome)) return { close: outcome, attempts, nextContactOn: null, startFollowUp: false }
  if (outcome === 'NO_CONTESTA') {
    const tried = attempts + 1
    return tried >= MAX_ATTEMPTS
      ? { close: 'SIN_RESPUESTA', attempts: tried, nextContactOn: null, startFollowUp: true }
      : { close: null, attempts: tried, nextContactOn: addDays(today, 1), startFollowUp: false }
  }
  // LO_PIENSO y CARO: vuelve en 3 dias. CARO queda en last_result y la ficha abre
  // con cuotas o precio de estudiante.
  return { close: null, attempts, nextContactOn: addDays(today, THINK_IT_OVER_DAYS), startFollowUp: false }
}

// Cadencia asistida: dias 1, 3 y 7 desde el ancla (la consulta, o el dia en que
// se dejo de llamar).
export const FOLLOW_UP_STEPS = [1, 3, 7]
export const followUpSchedule = (anchorOn) => FOLLOW_UP_STEPS.map((step) => ({ step, anchor_on: anchorOn, due_on: addDays(anchorOn, step) }))

// El nuevo con 1 consulta (BAJA) de la ultima semana entra a la cadencia, con
// los pasos que todavia no pasaron. Le toca a quien registro la consulta; si no
// es asesor (WEB, Fundacion), se reparte en ronda.
export function lowLevelFollowUps ({ candidates, advisors, today }) {
  const eligible = advisors.map((a) => a.user_id)
  let turn = 0
  const ownerOf = (c) => (eligible.includes(c.owner_id) ? c.owner_id : eligible[turn++ % eligible.length])
  if (!eligible.length) return []
  return candidates
    .filter((c) => !c.is_client && levelOf({ isClient: false, inquiries: c.inquiries }) === 'BAJA' && c.days <= FOLLOW_UP_STEPS.at(-1))
    .flatMap((c) => {
      const pending = followUpSchedule(c.consulted_on).filter((f) => f.due_on >= today)
      if (!pending.length) return []
      const user_id = ownerOf(c)
      return pending.map((f) => ({ ...f, phone_key: c.phone_key, client_name: c.client_name, program_id: c.program_id, user_id, reason: 'BAJA' }))
    })
}

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

const LEVEL_ORDER = { ALTA: 0, MEDIA: 1 }

// candidates: { phone_key, consulted_on, days, inquiries, is_client, tier, owner_id, ... }
// Orden: nivel, la consulta mas reciente y, a igual fecha, el programa que mas
// vale (TOP primero, factores medidos el 15/10/26).
export function rankCandidates (candidates) {
  return candidates
    .map((c) => {
      const tier = c.tier ?? 'BAJO'
      const level = levelOf({ isClient: c.is_client, inquiries: c.inquiries })
      const fresh = c.days < FIRST_ELIGIBLE_DAY
      return { ...c, tier, level, fresh, probability: expectedProbability({ level, fresh, inquiries: c.inquiries }) }
    })
    .filter((c) => isCallable({ level: c.level, days: c.days, isClient: c.is_client }))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
      b.consulted_on.localeCompare(a.consulted_on) ||
      (TIER_FACTOR[b.tier] ?? TIER_FACTOR.BAJO) - (TIER_FACTOR[a.tier] ?? TIER_FACTOR.BAJO) ||
      a.phone_key.localeCompare(b.phone_key))
    .map((c, position) => ({ ...c, position }))
}

// El control entra solo hasta donde llego el cupo de hoy: los llamados son la
// parte ALTA del ranking (hay 20 por asesor) y un control de todo el rango
// compararia mejores contra peores (lo delato la prueba A/A del 15/10/26: el
// control salia 30% en vez de 15%). Sin nadie asignado, no hay control.
export function controlWithinReach ({ control, assigned }) {
  if (!assigned.length) return []
  const cutoff = Math.max(...assigned.map((a) => a.position))
  return control.filter((c) => c.position <= cutoff)
}

// La consulta fresca es del asesor que la registro: se queda con el, pero con
// el mismo tope de 20 (sus 20 mejores; el resto lo sigue viendo en Leads). Lo
// demas se reparte en serpiente entre los que tienen cupo. Sin tope, el 16/10/26
// un asesor que registra mucho se llevo 145 llamadas en un dia.
export function distribute ({ ranked, advisors, maxOpen = MAX_OPEN_PER_ADVISOR }) {
  const room = new Map(advisors.map((a) => [a.user_id, Math.max(0, maxOpen - a.open)]))
  const owned = []
  for (const c of ranked) {
    if (!c.fresh || !room.get(c.owner_id)) continue
    owned.push({ ...c, user_id: c.owner_id })
    room.set(c.owner_id, room.get(c.owner_id) - 1)
  }
  // El fresco de un asesor sin cupo no se le pasa a otro: sigue siendo su lead.
  const notForSnake = new Set(ranked.filter((c) => c.fresh && room.has(c.owner_id)).map((c) => c.phone_key))
  const snake = distributeSnake({
    ranked: ranked.filter((c) => !notForSnake.has(c.phone_key)),
    advisors: advisors.map((a) => ({ ...a, open: maxOpen - room.get(a.user_id) })),
    maxOpen
  })
  return [...owned, ...snake]
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
