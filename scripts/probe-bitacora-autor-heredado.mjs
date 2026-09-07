// ¿Cuanto miente la bitacora al decir quien aprobo una venta?
//
// fn_audit_changes toma el autor de `user_modification_id` de la fila, y la
// confirmacion NO actualiza ese campo => el log hereda al ultimo que edito.
// Se mide contando los cambios de cat_fico_status atribuidos a usuarios que ni
// siquiera pueden ABRIR la ficha de inscripcion (union router + matriz).
import { q, pool } from './prod-db.mjs'

const PUEDEN_VER = ['ADMIN', 'FICO', 'LIDER_FICO', 'GERENCIA',
  'ACADEMICA', 'LIDER_ACADEMICA', 'LIDER_PRODUCTO', 'PRODUCTO']

const { rows } = await q(`
  WITH cambios AS (
    SELECT a.id, a.record_id::int AS enrollment_id, a.user_id, a.created_at
      FROM audit_logs a
     WHERE a.table_name = 'enrollments'
       AND a.action = 'UPDATE'
       AND a.changed_fields ? 'cat_fico_status'
  ), autor AS (
    SELECT c.*, u.alias,
           EXISTS (SELECT 1 FROM user_roles ur JOIN rol r ON r.rol_id = ur.rol_id
                    WHERE ur.user_id = c.user_id AND r.alias = ANY($1::text[])) AS puede_ver
      FROM cambios c LEFT JOIN users u ON u.user_id = c.user_id
  )
  SELECT COUNT(*)::int AS cambios_de_estado,
         COUNT(*) FILTER (WHERE NOT puede_ver)::int AS atribuidos_a_quien_no_puede,
         COUNT(*) FILTER (WHERE user_id IS NULL)::int AS sin_autor
    FROM autor`, [PUEDEN_VER])

console.log('Cambios de cat_fico_status registrados en la bitacora:', rows[0].cambios_de_estado)
console.log('  atribuidos a un usuario que NO puede abrir la ficha:', rows[0].atribuidos_a_quien_no_puede)
console.log('  sin autor:', rows[0].sin_autor)

const { rows: top } = await q(`
  -- COUNT(DISTINCT a.id): el LEFT JOIN a user_roles duplica la fila de auditoria
  -- por cada rol del usuario (AE30 tiene dos) e inflaba el conteo.
  SELECT u.alias, STRING_AGG(DISTINCT r.alias, ',') AS roles, COUNT(DISTINCT a.id)::int AS cambios
    FROM audit_logs a
    JOIN users u ON u.user_id = a.user_id
    LEFT JOIN user_roles ur ON ur.user_id = u.user_id
    LEFT JOIN rol r ON r.rol_id = ur.rol_id
   WHERE a.table_name = 'enrollments' AND a.action = 'UPDATE'
     AND a.changed_fields ? 'cat_fico_status'
   GROUP BY u.alias
   HAVING NOT BOOL_OR(r.alias = ANY($1::text[]))
   ORDER BY cambios DESC LIMIT 10`, [PUEDEN_VER])

console.log('\n=== "Aprobadores" imposibles (no tienen acceso a la pantalla) ===')
console.table(top)

// Contraste: el campo que la aplicacion SI podria usar para el actor.
const { rows: [mod] } = await q(`
  SELECT COUNT(*)::int AS total,
         COUNT(user_modification_id)::int AS con_modificador
    FROM enrollments WHERE active = 'Y'`)
console.log(`\nenrollments con user_modification_id: ${mod.con_modificador} de ${mod.total}`)

await pool.end()
