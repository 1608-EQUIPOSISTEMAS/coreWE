// Reglas puras del modulo Retirados: en que punto esta la encuesta de retiro de
// cada alumno y a quien se le puede mandar. Sin I/O.
//
// La encuesta la responde el alumno en Nexus; responderla lo inscribe en el
// sorteo de una beca online. Por eso "respondida" es el estado que importa: es
// la lista de participantes.

export const ESTADO = Object.freeze({
  SIN_ENVIAR: 'sin_enviar',
  ENVIADA: 'enviada',
  RESPONDIDA: 'respondida'
})

export function estadoEncuesta ({ enviada_at: enviadaAt, respondida_at: respondidaAt }) {
  if (respondidaAt) return ESTADO.RESPONDIDA
  if (enviadaAt) return ESTADO.ENVIADA
  return ESTADO.SIN_ENVIAR
}

/**
 * Decide si a este retirado se le puede mandar el correo de la encuesta.
 *
 * @param {{ email: string|null, estado: string, envios: number }} retirado
 *   `estado` es el de `estadoEncuesta`; `envios`, cuantas veces ya se le mando.
 * @returns {string|null} null si se puede enviar; si no, el motivo que vera FICO
 *   (ej. 'Sin correo').
 */
export function motivoParaNoEnviar ({ email, estado, envios }) {
  if (!email?.trim()) return 'Sin correo'
  if (estado === ESTADO.RESPONDIDA) return 'Ya respondió la encuesta'
  // Un solo correo por retirado (FICO, 19/10/26): si no responde, no se insiste.
  if (envios > 0) return 'La encuesta ya se envió'
  return null
}

export function buildRetirados (rows) {
  const items = rows.map(r => {
    const item = { ...r, envios: Number(r.envios || 0), estado: estadoEncuesta(r) }
    return { ...item, bloqueo_envio: motivoParaNoEnviar(item) }
  })
  const kpis = { total: items.length, sin_enviar: 0, enviada: 0, respondida: 0 }
  for (const it of items) kpis[it.estado]++
  return { items, kpis }
}
