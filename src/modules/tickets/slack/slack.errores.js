/**
 * Un DomainError trae un mensaje escrito para leerse (no hay cuenta en el ERP,
 * no hay agentes...); cualquier otra cosa se enmascara y se queda en el log.
 * Mismo criterio para el DM, los botones y el comando /estado.
 */
export function mensajeDeError (err, etiqueta) {
  if (err?.expose) return `❌ ${err.message}`
  console.error(`${etiqueta}:`, err)
  return '❌ Se me complicó procesar tu mensaje. Inténtalo de nuevo en un momento.'
}
