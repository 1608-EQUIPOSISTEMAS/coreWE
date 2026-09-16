// Lista los casos de Reprogramaciones con veredicto "rechazado" y quien lo dio.
// Solo lectura. Uso (desde Backend/): node scripts/probe-reprogram-rechazados.mjs
import { q, pool } from './db.mjs'

const { rows: [db] } = await q('SELECT current_database() AS db, inet_server_port() AS port')
console.log('BD:', db)

const { rows } = await q(`
  SELECT rc.reprogram_case_id, rc.enrollment_id, rc.status, rc.dest_kind,
         rc.dest_program_version_id, rc.dest_edition_id,
         rc.contacted_at, rc.contact_notes,
         rc.verdict_by, u.name AS usuario, rc.verdict_at, rc.verdict_notes,
         rc.new_enrollment_id, rc.pending_steps,
         per.first_name, per.last_name, per.document_number
    FROM public.reprogram_cases rc
    LEFT JOIN public.users u ON u.user_id = rc.verdict_by
    JOIN public.enrollments e ON e.enrollment_id = rc.enrollment_id
    JOIN public.customers cu ON cu.customer_id = e.customer_id
    JOIN public.persons per ON per.person_id = cu.person_id
   WHERE rc.active = 'Y' AND rc.status = 'rechazado'
   ORDER BY rc.verdict_at DESC`)
console.table(rows)
await pool.end()
