// One-off 2026-08-05: ventas registradas desde el modulo de Fundacion antes del
// fix (useLeadForm ahora manda agent_origin='FWE'). Quedaron con agent_origin
// NULL y solo el alias del asesor de Fundacion (VAFUN, user_id 47).
import { q, pool } from './db.mjs'

const VAFUN = 47

const { rows: antes } = await q(`
  SELECT e.enrollment_id, e.registration_date::date fecha, pv.abbreviation programa,
         p2.document_number doc, e.agent_origin
    FROM enrollments e
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN program_versions pv ON pv.program_version_id = COALESCE(e.program_version_id, pe.program_version_id)
    LEFT JOIN customers c ON c.customer_id = e.customer_id
    LEFT JOIN persons p2 ON p2.person_id = c.person_id
   WHERE e.seller_agent_id = $1
   ORDER BY e.registration_date DESC`, [VAFUN])
console.table(antes)

// seller_agent_id se nulea: en los canales WE el canal ES el asesor. Sin esto
// el listado muestra 'FWE - VAFUN' y el usuario pide 'FWE' a secas.
const { rows: after } = await q(`
  UPDATE enrollments
     SET agent_origin = 'FWE', seller_agent_id = NULL, modification_date = NOW()
   WHERE seller_agent_id = $1
  RETURNING enrollment_id, agent_origin`, [VAFUN])
console.log('Actualizados:', after)

await q('REFRESH MATERIALIZED VIEW mv_enrollment_report_system').catch(e =>
  console.warn('matview no refrescada:', e.message))

await pool.end()
