// ¿Qué ventas anunciaron credenciales de campus sin que exista NADIE en Odoo?
//
// enrollInOdoo se salta al padre cuando `program_edition_id IS NULL` y el
// producto tiene hijos (regla `isE0Parent`), asumiendo que los hijos se
// inscriben individualmente. En un producto ONLINE, que por diseño no tiene
// program_editions, los hijos también nacen con edición NULL y tampoco llegan a
// Odoo: no se inscribe nadie. Y el skip devuelve `success: true`, así que la
// guarda anti-credenciales-falsas de sendConfirmationEmail lo da por bueno y
// manda el correo con el login sintetizado.
//
// Roto de verdad = padre sin odoo_user_id Y cero hijos en Odoo. Solo lectura.
import { q, pool } from './prod-db.mjs'

const { rows } = await q(`
  WITH padres AS (
    SELECT e.enrollment_id, e.registration_date::date AS fecha, e.agent_origin,
           pv.abbreviation AS programa, prog.program_id,
           prog.odoo_activation, cm.alias AS modalidad,
           (SELECT COUNT(*) FROM enrollments h
             WHERE h.parent_enrollment_id = e.enrollment_id)::int AS hijos,
           (SELECT COUNT(*) FROM enrollments h
             WHERE h.parent_enrollment_id = e.enrollment_id
               AND h.odoo_user_id IS NOT NULL)::int AS hijos_en_odoo
      FROM enrollments e
      LEFT JOIN program_versions pv   ON pv.program_version_id = e.program_version_id
      LEFT JOIN programs prog         ON prog.program_id = pv.program_id
      LEFT JOIN catalog cm            ON cm.catalog_id = prog.cat_model_modality
     WHERE e.program_edition_id IS NULL
       AND e.parent_enrollment_id IS NULL
       AND e.active = 'Y'
       AND e.odoo_user_id IS NULL
  )
  SELECT p.*, l.to_email, l.sent_at::date AS correo_enviado
    FROM padres p
    LEFT JOIN LATERAL (
      SELECT to_email, sent_at FROM email_logs
       WHERE enrollment_id = p.enrollment_id
         AND template_type = 'confirmacion' AND status = 'sent'
       ORDER BY sent_at DESC LIMIT 1) l ON TRUE
   WHERE p.hijos > 0 AND p.hijos_en_odoo = 0
   ORDER BY p.enrollment_id DESC`)

console.log('=== NADIE EN ODOO (ni padre ni hijos) ===')
console.table(rows)
console.log('total:', rows.length,
  '| con correo de credenciales ya enviado:', rows.filter(r => r.correo_enviado).length)

await pool.end()
