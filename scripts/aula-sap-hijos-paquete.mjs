// Hijos de los 6 paquetes de ESPEC. SAP LOG. INTEGRAL (ED 15625): quién NO tiene
// curso en SAP HANA MM (15626).
import { q, pool } from './db.mjs'

const PADRES = [14027, 3910, 4544, 13309, 13725, 14867]

const { rows } = await q(`
 SELECT h.parent_enrollment_id AS padre, h.enrollment_id, h.program_edition_id AS ed,
        p.program_name, pe.start_date, h.active,
        cf.alias AS fico, cts.alias AS type_status, h.total_amount
   FROM public.enrollments h
   LEFT JOIN public.program_editions pe ON pe.edition_num_id = h.program_edition_id
   LEFT JOIN public.program_versions pv ON pv.program_version_id = COALESCE(pe.program_version_id, h.program_version_id)
   LEFT JOIN public.programs p ON p.program_id = pv.program_id
   LEFT JOIN public."catalog" cf ON cf.catalog_id = h.cat_fico_status
   LEFT JOIN public."catalog" cts ON cts.catalog_id = h.cat_type_status
  WHERE h.parent_enrollment_id = ANY($1::int[])
  ORDER BY h.parent_enrollment_id, pe.start_date NULLS FIRST
`, [PADRES])
console.table(rows)

await pool.end()
