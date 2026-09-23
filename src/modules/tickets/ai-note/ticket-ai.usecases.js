import * as defaultRepo from './ticket-ai.repository.js'
import { buildTicketFacts, buildTicketMessages, parseTicketNote, noteFor, ticketFingerprint } from './ticket-ai.entity.js'
import { ollamaChatJson, ollamaModel, queueLength } from '../../../shared/adapters/llm/ollama.adapter.js'

// Se genera en segundo plano al crear el ticket (y, para los viejos, la primera
// vez que alguien abre el detalle). Best-effort: sin IA el ticket funciona igual.

// APAGADO por defecto: AI_TICKET_NOTES=true lo enciende (solo produccion).
export const ticketNotesEnabled = (env = process.env) => env.AI_TICKET_NOTES === 'true'

const enCurso = new Map()
const fallas = new Map()
const ERROR_TTL_MS = 10 * 60 * 1000

// ticket = fila de repo.detail + `area` (ticketAreaLabel). Nunca lanza.
export function startTicketNote (ticket, { repo = defaultRepo, llm = ollamaChatJson, env = process.env } = {}) {
  if (!ticketNotesEnabled(env)) return Promise.resolve(null)
  const id = ticket.ticket_id
  if (enCurso.has(id)) return enCurso.get(id)
  const fingerprint = ticketFingerprint(ticket)
  const tarea = (async () => {
    const messages = buildTicketMessages(buildTicketFacts(ticket))
    for (let intento = 1; intento <= 2; intento++) {
      let payload = null
      try {
        payload = parseTicketNote(await llm(messages, { maxTokens: 260, temperature: 0.2 }))
      } catch (err) {
        if (intento === 2 || err.name === 'TimeoutError') throw err
      }
      if (payload) {
        await repo.saveNote({ ticketId: id, fingerprint, payload, model: ollamaModel() })
        return payload
      }
    }
    throw new Error('el modelo no devolvio una nota valida')
  })()
    .catch(err => {
      fallas.set(id, { fingerprint, at: Date.now() })
      console.warn(`[tickets][ia] ticket #${id}: ${err.message}`)
      return null
    })
    .finally(() => enCurso.delete(id))
  enCurso.set(id, tarea)
  return tarea
}

// Lectura para el detalle. `ticket` ya paso assertCanRead en quien llama.
export async function getTicketNote ({ ticket, canManage }, { repo = defaultRepo, llm = ollamaChatJson, env = process.env } = {}) {
  if (!ticketNotesEnabled(env)) return { estado: 'apagado' }
  const id = ticket.ticket_id
  const fingerprint = ticketFingerprint(ticket)
  const guardada = await repo.fetchNote(id)
  if (guardada && guardada.fingerprint === fingerprint) {
    return { estado: 'listo', generated_at: guardada.generated_at, ...noteFor(guardada.payload, { canManage }) }
  }
  const falla = fallas.get(id)
  if (!enCurso.has(id) && falla?.fingerprint === fingerprint && Date.now() - falla.at < ERROR_TTL_MS) {
    return { estado: 'error' }
  }
  // Un ticket cerrado no amerita gastar CPU en una nota que nadie va a usar.
  if (ticket.status === 'CERRADO' && !guardada) return { estado: 'sin_nota' }
  startTicketNote(ticket, { repo, llm, env })
  return { estado: 'generando', en_fila: queueLength() }
}
