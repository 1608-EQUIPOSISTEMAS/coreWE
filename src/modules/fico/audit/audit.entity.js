import { DomainError } from '../../../shared/errors.js'

// Reglas e invariantes puras del registro de auditoria FICO. Sin acceso a BD,
// red ni reloj oculto: toda decision se toma sobre el payload en memoria. El
// log de auditoria es la bitacora transversal de toda accion FICO sobre una
// inscripcion (enrollment_audit_log), y este modulo fija que acciones son
// validas y como se normaliza una entrada antes de persistirla.

// Acciones canonicas que cualquier subdominio FICO puede registrar. Mantener
// esta lista como fuente unica evita que un typo ('aproved') ensucie la
// timeline y rompa filtros/contadores aguas abajo.
export const CANONICAL_ACTIONS = Object.freeze([
  'created',
  'approved',
  'observed',
  'retired',
  'edited',
  'odoo_enrolled',
  'odoo_fees_activated',
  'odoo_fee_paid',
  'email_sent',
  'email_failed',
  'seller_agent_changed'
])

export function isCanonicalAction (action) {
  return CANONICAL_ACTIONS.includes(action)
}

// Normaliza y valida una entrada de auditoria antes de mandarla al repository.
// No restringe a la lista canonica de forma dura (el legacy aceptaba cualquier
// string libre y otros subdominios siguen agregando acciones nuevas), pero si
// exige los campos minimos: enrollmentId y action presentes.
//
// Serializa `changes` a JSON aqui para que el repository reciba ya el string
// listo para el cast ::jsonb, manteniendo la query verbatim del legacy. El
// resto de campos opcionales caen a null para no enviar undefined a la BD.
//
// @param {object} input  { enrollmentId, action, userId, justificacion, changes, details }
// @returns {{ enrollmentId, action, userId, justificacion, changesJson, details }}
// @throws {DomainError} si falta enrollmentId o action
export function normalizeAuditEntry (input = {}) {
  const { enrollmentId, action } = input
  if (enrollmentId == null) {
    throw new DomainError('enrollmentId es requerido para registrar auditoria')
  }
  if (!action || typeof action !== 'string' || !action.trim()) {
    throw new DomainError('action es requerida para registrar auditoria')
  }

  return {
    enrollmentId,
    action: action.trim(),
    userId: input.userId ?? null,
    justificacion: input.justificacion ?? null,
    changesJson: input.changes != null ? JSON.stringify(input.changes) : null,
    details: input.details ?? null
  }
}
