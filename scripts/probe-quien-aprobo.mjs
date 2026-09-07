// Hay DOS bitacoras y no dicen lo mismo:
//   audit_logs           -> trigger fn_audit_changes, autor = user_modification_id (heredado)
//   enrollment_audit_log -> logAudit del usecase, performed_by = usuario del JWT (real)
// Este script las enfrenta sobre la accion que importa: la aprobacion.
import { q, pool } from './prod-db.mjs'

console.log('=== Caso 18507: las dos versiones del mismo hecho ===')
console.table((await q(`
  SELECT 'enrollment_audit_log' AS fuente, al.action, u.alias AS autor,
         STRING_AGG(DISTINCT r.alias, ',') AS roles, al.performed_at AS cuando
    FROM enrollment_audit_log al
    LEFT JOIN users u ON u.user_id = al.performed_by
    LEFT JOIN user_roles ur ON ur.user_id = u.user_id
    LEFT JOIN rol r ON r.rol_id = ur.rol_id
   WHERE al.enrollment_id = 18507
   GROUP BY al.audit_id, al.action, u.alias, al.performed_at
   ORDER BY al.performed_at`)).rows)

console.log('\n=== ¿Cubre la bitacora buena todas las aprobaciones? ===')
console.table((await q(`
  WITH aprobadas AS (
    SELECT e.enrollment_id FROM enrollments e
      JOIN catalog cf ON cf.catalog_id = e.cat_fico_status
                     AND cf.alias = 'we_enrollment_status_checked'
     WHERE e.active = 'Y'
  )
  SELECT COUNT(*)::int AS inscripciones_aprobadas,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM enrollment_audit_log al
            WHERE al.enrollment_id = a.enrollment_id AND al.action = 'approved'
         ))::int AS con_registro_de_aprobacion
    FROM aprobadas a`)).rows)

console.log('\n=== Quien aprueba, segun la bitacora que si guarda al ejecutor ===')
console.table((await q(`
  SELECT u.alias AS autor, STRING_AGG(DISTINCT r.alias, ',') AS roles,
         COUNT(DISTINCT al.audit_id)::int AS aprobaciones
    FROM enrollment_audit_log al
    LEFT JOIN users u ON u.user_id = al.performed_by
    LEFT JOIN user_roles ur ON ur.user_id = u.user_id
    LEFT JOIN rol r ON r.rol_id = ur.rol_id
   WHERE al.action = 'approved'
   GROUP BY u.alias
   ORDER BY aprobaciones DESC`)).rows)

await pool.end()
