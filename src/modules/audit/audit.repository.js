import { pool } from '../../shared/db/pool.js'

// Lectura de audit_logs, la bitácora que llenan los triggers fn_audit_changes.
// Este módulo NO escribe: quien audita nunca modifica la evidencia.
export class AuditRepository {
  constructor (db = pool) {
    this.db = db
  }

  // Una página de movimientos, del más reciente al más viejo.
  //
  // Se ordena por id y no por created_at porque audit_logs solo tiene índice en
  // la PK: con medio millón de filas, ORDER BY created_at obliga a un seq scan
  // completo. El id es bigserial, así que el orden es el mismo.
  //
  // old_data/new_data quedan fuera del SELECT: son la fila entera en jsonb y
  // multiplicarían por veinte el payload de la página.
  // ponytail: solo se devuelve el diff (changed_fields). Si algún día hace falta
  // la foto completa del registro, va en un endpoint de detalle por id.
  //
  // created_at sale ya formateado con to_char porque la columna es `timestamp
  // WITHOUT time zone` y guarda hora de Lima (el pool hace SET TIME ZONE
  // 'America/Lima' al conectar). Devolverlo como Date lo hacía viajar por dos
  // zonas horarias adivinadas —la del proceso Node y la del navegador— y en
  // producción la vista mostraba la hora corrida.
  async listLogs ({ auditableRoles, tableName, action, userId, recordId, dateFrom, dateTo, limit, offset }) {
    const { rows } = await this.db.query(`
      SELECT a.id,
             to_char(a.created_at, 'DD/MM/YYYY HH24:MI') AS created_at,
             a.table_name, a.record_id, a.action,
             a.user_id, u.alias AS user_alias, a.changed_fields
        FROM public.audit_logs a
        LEFT JOIN public.users u ON u.user_id = a.user_id
       WHERE ($1::text[] IS NULL OR a.user_id IN (
               SELECT ur.user_id FROM public.user_roles ur
                 JOIN public.rol r ON r.rol_id = ur.rol_id
                WHERE r.alias = ANY($1)))
         AND ($2::text IS NULL OR a.table_name = $2)
         AND ($3::text IS NULL OR a.action = $3)
         AND ($4::int  IS NULL OR a.user_id = $4)
         AND ($5::int  IS NULL OR a.record_id = $5)
         AND ($6::date IS NULL OR a.created_at >= $6::date)
         AND ($7::date IS NULL OR a.created_at < $7::date + 1)
       ORDER BY a.id DESC
       LIMIT $8 OFFSET $9
    `, [auditableRoles, tableName, action, userId, recordId, dateFrom, dateTo, limit + 1, offset])
    return rows
  }

  // Usuarios que el consultante puede filtrar. Alimenta el desplegable de la
  // vista; con auditableRoles = null son todos.
  async listAuditableUsers (auditableRoles) {
    const { rows } = await this.db.query(`
      SELECT DISTINCT u.user_id, u.alias
        FROM public.users u
        LEFT JOIN public.user_roles ur ON ur.user_id = u.user_id
        LEFT JOIN public.rol r ON r.rol_id = ur.rol_id
       WHERE $1::text[] IS NULL OR r.alias = ANY($1)
       ORDER BY u.alias
    `, [auditableRoles])
    return rows
  }
}

export const auditRepository = new AuditRepository()
