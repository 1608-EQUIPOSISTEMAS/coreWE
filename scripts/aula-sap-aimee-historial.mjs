// Historial de AIMEE (padre 14027): ¿ya llevó SAP HANA MM antes? (convalidación)
import { q, pool } from './db.mjs'

const { rows } = await q(`
  SELECT e.enrollment_id, e.registration_date::date AS fecha, e.program_edition_id AS ed,
         p.program_name, pe.start_date::date AS inicio, e.total_amount, e.parent_enrollment_id,
         cts.alias AS type_status, cf.alias AS fico, e.active
    FROM public.enrollments e
    JOIN public.customers cu ON cu.customer_id = e.customer_id
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = COALESCE(pe.program_version_id, e.program_version_id)
    LEFT JOIN public.programs p ON p.program_id = pv.program_id
    LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
    LEFT JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
   WHERE cu.person_id = (SELECT cu2.person_id FROM public.customers cu2
                          JOIN public.enrollments e2 ON e2.customer_id = cu2.customer_id
                         WHERE e2.enrollment_id = 14027)
   ORDER BY e.registration_date
`)
console.table(rows)
await pool.end()
