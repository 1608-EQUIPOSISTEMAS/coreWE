// Allowlist anti-SSRF de los servicios de IA internos (sidecar ai-auditor y
// Ollama local). Vive en shared/ porque la usan un modulo (edition) y un
// adaptador (shared/adapters/llm): un adaptador no puede importar de un modulo.
// Pura: el env se lee en cada llamada, no en import-time, para que un host
// invalido no tumbe el arranque.

// Hosts permitidos. Loopback siempre + los declarados en AI_AUDITOR_ALLOWED_HOSTS.
export function aiAuditorAllowedHosts (env = process.env) {
  return new Set([
    '127.0.0.1', 'localhost', '::1',
    ...(env.AI_AUDITOR_ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean)
  ])
}

// Resuelve y valida la URL del Ollama local contra la allowlist. Lanza si el
// host no esta permitido.
export function resolveOllamaUrl (env = process.env) {
  const raw = env.OLLAMA_URL || 'http://127.0.0.1:11434'
  const allowed = aiAuditorAllowedHosts(env)
  let hostname
  try {
    hostname = new URL(raw).hostname
  } catch (err) {
    throw new Error(`OLLAMA_URL invalida: ${err.message}`)
  }
  if (!allowed.has(hostname)) {
    throw new Error(`OLLAMA_URL host no permitido: ${hostname}. Agregalo a AI_AUDITOR_ALLOWED_HOSTS.`)
  }
  return raw
}
