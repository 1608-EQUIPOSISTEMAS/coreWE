import * as defaultRepo from './lead-summary.repository.js'
import { attemptsFingerprint, leadFacts, buildSummaryMessages, parseSummary } from './lead-summary.entity.js'
import { ollamaChatJson, ollamaModel, queueLength } from '../../../shared/adapters/llm/ollama.adapter.js'
import { NotFoundError } from '../../../shared/errors.js'

// Se genera en segundo plano y se guarda: el modelo en CPU tarda ~20-40 s y la
// ficha del lead no puede esperar eso. La primera vez el front ve "generando"
// y consulta de nuevo; despues sale al instante hasta que haya intentos nuevos.

// Leads generandose en este proceso: evita encolar el mismo dos veces si el
// asesor recarga la ficha.
// APAGADO por defecto: AI_LEAD_SUMMARY=true lo enciende (solo produccion).
export const leadSummaryEnabled = (env = process.env) => env.AI_LEAD_SUMMARY === 'true'

const enCurso = new Map()
// Ultima falla por lead (huella + hora): durante un rato se responde 'error' en
// vez de reintentar en cada consulta del front, que quedaria sondeando para siempre.
const fallas = new Map()
const ERROR_TTL_MS = 10 * 60 * 1000

export async function getLeadSummary ({ leadId }, { repo = defaultRepo, llm = ollamaChatJson, env = process.env } = {}) {
  if (!leadSummaryEnabled(env)) return { estado: 'apagado' }
  const lead = await repo.fetchLead(leadId)
  if (!lead) throw new NotFoundError('Lead no encontrado')
  const attempts = await repo.fetchAttempts(leadId)
  if (!attempts.length) return { estado: 'sin_intentos' }

  const fingerprint = attemptsFingerprint(attempts)
  const guardado = await repo.fetchSummary(leadId)
  if (guardado && guardado.fingerprint === fingerprint) {
    return { estado: 'listo', ...guardado.payload, generated_at: guardado.generated_at }
  }

  const anterior = guardado ? { ...guardado.payload, generated_at: guardado.generated_at } : null
  const falla = fallas.get(leadId)
  if (!enCurso.has(leadId) && falla?.fingerprint === fingerprint && Date.now() - falla.at < ERROR_TTL_MS) {
    return { estado: 'error', anterior }
  }

  if (!enCurso.has(leadId)) {
    fallas.delete(leadId)
    const tarea = generate({ lead, attempts, fingerprint, repo, llm })
      .catch(err => {
        fallas.set(leadId, { fingerprint, at: Date.now() })
        console.warn(`[lead-summary] lead ${leadId}: ${err.message}`)
      })
      .finally(() => enCurso.delete(leadId))
    enCurso.set(leadId, tarea)
  }
  // Mientras tanto se muestra el resumen anterior (si habia), marcado como viejo.
  return { estado: 'generando', en_fila: queueLength(), anterior }
}

async function generate ({ lead, attempts, fingerprint, repo, llm }) {
  const messages = buildSummaryMessages(leadFacts(lead, attempts))
  // Un reintento: el 7B a veces devuelve JSON roto o sin una de las claves.
  let ultimoError = null
  for (let intento = 1; intento <= 2; intento++) {
    let payload = null
    try {
      payload = parseSummary(await llm(messages, { maxTokens: 220, temperature: 0.2 }))
    } catch (err) {
      ultimoError = err
      // Timeout o Ollama caido: reintentar solo sumaria otros 2 minutos de espera.
      if (err.name === 'TimeoutError' || /respondio|fetch failed|ECONNREFUSED/.test(err.message)) break
    }
    if (payload) {
      await repo.saveSummary({ leadId: lead.lead_id, fingerprint, payload, model: ollamaModel() })
      return payload
    }
  }
  throw new Error(ultimoError ? ultimoError.message : 'el modelo no devolvio resumen y siguiente_paso')
}

// Pre-calentado nocturno (services/lead-summary.cron.js): deja listos los
// resumenes de los leads que se movieron ayer. En serie, se corta tras 2 fallas
// seguidas (Ollama caido) para no quemar la madrugada en timeouts.
export async function prewarmLeadSummaries ({ limit = 40, repo = defaultRepo, llm = ollamaChatJson, log = console } = {}) {
  const ids = await repo.fetchPrewarmCandidates(limit)
  let hechos = 0
  let fallas = 0
  for (const leadId of ids) {
    if (fallas >= 2) break
    try {
      const lead = await repo.fetchLead(leadId)
      const attempts = lead ? await repo.fetchAttempts(leadId) : []
      if (!attempts.length) continue
      await generate({ lead, attempts, fingerprint: attemptsFingerprint(attempts), repo, llm })
      hechos++
      fallas = 0
    } catch (err) {
      fallas++
      log.warn(`[lead-summary] prewarm lead ${leadId}: ${err.message}`)
    }
  }
  log.log(`[lead-summary] prewarm: ${hechos}/${ids.length} resumenes`)
  return { candidatos: ids.length, hechos }
}
