import { pool } from '../../../shared/db/pool.js'

// Acceso a datos del log de auditoria FICO (enrollment_audit_log). Las queries
// se conservan verbatim desde fico.service.js (logAudit 1880-1889, getAuditLog
// 1912-1922): mismos parametros, mismo orden, mismo SQL.

export const auditRepository = {
  // Inserta una entrada de bitacora. Best-effort: un fallo al auditar no debe
  // tumbar la operacion de negocio que la dispara, asi que el error se traga y
  // se loguea, identico al comportamiento del service legacy.
  async insert ({ enrollmentId, action, userId, justificacion, changesJson, details }) {
    try {
      await pool.query(`
        INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      `, [enrollmentId, action, userId, justificacion, changesJson, details])
    } catch (err) {
      console.error('[AuditLog] Error:', err.message)
    }
  },

  // Devuelve la timeline de auditoria de una inscripcion, mas reciente primero,
  // resolviendo el alias del usuario que ejecuto cada accion.
  async listByEnrollment (enrollmentId) {
    const { rows } = await pool.query(`
      SELECT al.audit_id, al.action, al.performed_at, al.justificacion, al.changes, al.details,
             u.alias AS user_name
      FROM enrollment_audit_log al
      LEFT JOIN users u ON u.user_id = al.performed_by
      WHERE al.enrollment_id = $1
      ORDER BY al.performed_at DESC
    `, [enrollmentId])
    return rows || []
  }
}
