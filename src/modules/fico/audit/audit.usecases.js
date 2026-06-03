import { auditRepository } from './audit.repository.js'
import { normalizeAuditEntry } from './audit.entity.js'
import { toAuditLogDto } from './audit.dto.js'

// Casos de uso del log de auditoria FICO. No contiene SQL (delega en el
// repository) ni reglas de normalizacion (delega en la entity). Es un helper
// transversal: casi todos los subdominios FICO llaman `logAudit` para dejar
// rastro de sus acciones, y la consulta `getAuditLog` alimenta la timeline del
// detalle de inscripcion.

const repo = auditRepository

// Registra una accion sobre una inscripcion. Best-effort por diseno (el
// repository traga el error de BD), igual que el service legacy: auditar nunca
// debe romper la operacion de negocio que lo invoca.
export async function logAudit (input) {
  try {
    await repo.insert(normalizeAuditEntry(input))
  } catch (err) {
    console.error('[AuditLog] Error:', err.message)
  }
}

// Devuelve la timeline de auditoria de una inscripcion, mas reciente primero.
export async function getAuditLog ({ enrollmentId }) {
  return toAuditLogDto(await repo.listByEnrollment(enrollmentId))
}
