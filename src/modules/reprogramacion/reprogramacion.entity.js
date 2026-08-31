// Reglas puras del modulo Reprogramaciones. Sin I/O: se testean solas.

export class ReprogramacionError extends Error {
  constructor (message) {
    super(message)
    this.name = 'ReprogramacionError'
    this.statusCode = 400
  }
}

export const ESTADO = {
  DETECTADO: 'detectado',
  PROPUESTO: 'propuesto',
  CONTACTADO: 'contactado',
  ACEPTADO: 'aceptado',
  RECHAZADO: 'rechazado',
  CERRADO: 'cerrado'
}

export const KIND = {
  REPROGRAMACION: 'RP',
  CAMBIO_DE_CURSO: 'CC',
  REEMBOLSO: 'RF'
}

// El motor lo decide el destino, no el usuario: quedarse en el mismo programa es
// una Reprogramacion; irse a otro es un Cambio de Curso. Son dos casos de uso
// distintos de FICO y el de la izquierda exige mismo program_version.
export function resolveDestKind ({ originProgramVersionId, destProgramVersionId, destEditionId, refund = false }) {
  // El que pide su plata de vuelta no tiene destino academico: el caso queda
  // registrado y el reembolso lo procesa Contabilidad fuera del ERP.
  if (refund) return KIND.REEMBOLSO
  if (!destProgramVersionId) throw new ReprogramacionError('Falta el programa destino')
  const kind = Number(originProgramVersionId) === Number(destProgramVersionId)
    ? KIND.REPROGRAMACION
    : KIND.CAMBIO_DE_CURSO
  // Quedarse en el mismo programa sin decir en que edicion no significa nada:
  // el RP existe justamente para mover de una edicion a otra. El CC si admite
  // destino sin edicion (membresias y programas online no tienen).
  if (kind === KIND.REPROGRAMACION && !destEditionId) {
    throw new ReprogramacionError('Para reprogramar dentro del mismo programa hay que elegir la edicion destino')
  }
  return kind
}

// Sin fila en reprogram_cases el caso existe igual: es un afectado que nadie
// tomo todavia. Por eso el estado se deriva y no se siembra.
export function estadoDelCaso (caso) {
  return caso?.status || ESTADO.DETECTADO
}

export function assertPuedeProponer (caso) {
  const estado = estadoDelCaso(caso)
  if (estado === ESTADO.ACEPTADO) {
    throw new ReprogramacionError('El caso ya se ejecuto: no se puede cambiar el destino')
  }
}

// FICO solo firma lo que ya tiene destino elegido y alumno contactado: el
// veredicto es la confirmacion de una conversacion, no el primer paso.
export function assertPuedeAceptar (caso) {
  const estado = estadoDelCaso(caso)
  if (estado === ESTADO.ACEPTADO) throw new ReprogramacionError('El caso ya se ejecuto')
  // El reembolso es el unico veredicto sin destino: no hay a donde mandarlo.
  if (caso?.dest_kind !== KIND.REEMBOLSO && !caso?.dest_edition_id && !caso?.dest_program_version_id) {
    throw new ReprogramacionError('Academica todavia no eligio el destino')
  }
  if (estado !== ESTADO.CONTACTADO) {
    throw new ReprogramacionError('Falta marcar al alumno como contactado')
  }
}

// El alumno no paga por una edicion que cancelamos nosotros: el destino se cobra
// al mismo neto que ya pago. Si el programa nuevo vale mas, la diferencia es una
// decision comercial aparte, fuera de este flujo.
export function netoDeLaVenta ({ total_amount, discount_amount }) {
  return Number(total_amount || 0) - Number(discount_amount || 0)
}

export function buildJustificacion ({ edicionesCaidas = [], destino }) {
  const caidas = edicionesCaidas.filter(Boolean).join(', ') || 'edicion cancelada'
  return `Reubicacion por cancelacion de ${caidas}. Destino aprobado por FICO: ${destino || 's/d'}.`
}
