// Cliente del Ollama local (API OpenAI-compatible) para procesos en segundo
// plano. La URL pasa por la misma allowlist anti-SSRF del auditor IA
// (resolveOllamaUrl). En produccion el backend corre en Docker y Ollama nativo
// en el host: OLLAMA_URL apunta a host.docker.internal (ver docker-compose.yml).
//
// El servidor no tiene GPU: un 7B en CPU da ~5 tokens/s y atiende de a una
// peticion. Por eso el timeout es largo y todas las llamadas pasan por una
// fila (una a la vez por proceso): en paralelo solo se encolarian en Ollama y
// cada una tardaria lo que todas juntas.
import { resolveOllamaUrl } from '../../utils/ai-hosts.js'

export function ollamaModel (env = process.env) {
  return env.OLLAMA_MODEL || 'qwen2.5:7b-instruct'
}

// Fila en serie: cada llamada espera a que termine la anterior (bien o mal).
let cola = Promise.resolve()
let enEspera = 0

export function enqueue (fn) {
  enEspera++
  const turno = cola.then(fn)
  cola = turno.catch(() => {}).finally(() => { enEspera-- })
  return turno
}

// Cuantas llamadas hay delante (incluida la que corre). Sirve para decirle al
// usuario "en fila" en vez de dejarlo mirando un spinner sin explicacion.
export function queueLength () {
  return enEspera
}

export async function ollamaChatMessages (messages, {
  maxTokens = 200,
  temperature = 0.3,
  timeoutMs = 120000,
  json = false,
  env = process.env
} = {}) {
  return enqueue(async () => {
    const baseUrl = resolveOllamaUrl(env)
    const body = { model: ollamaModel(env), temperature, max_tokens: maxTokens, messages }
    // Modo JSON de Ollama: fuerza salida parseable (no garantiza el esquema,
    // eso lo valida quien llama).
    if (json) body.response_format = { type: 'json_object' }
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) throw new Error(`Ollama respondio ${res.status}`)
    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content
    if (!text || !String(text).trim()) throw new Error('Ollama devolvio respuesta vacia')
    return String(text).trim()
  })
}

// Pide JSON y lo parsea. Lanza si el modelo devolvio algo que no es un objeto.
export async function ollamaChatJson (messages, opts = {}) {
  const text = await ollamaChatMessages(messages, { ...opts, json: true })
  const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Ollama no devolvio un objeto JSON')
  return parsed
}
