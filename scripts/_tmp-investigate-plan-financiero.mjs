import { q, pool } from './db.mjs'

const vista = await q(`
  SELECT pg_get_viewdef(c.oid) AS def
  FROM pg_class c
  WHERE c.relname = 'v_dashboard_program_goals'`)
console.log('=== v_dashboard_program_goals ===')
console.log(vista.rows[0]?.def || '(no existe)')

const ediciones = await q(`
  SELECT pe.edition_num_id, pe.start_date, pe.active, p.program_name, pv.program_version_id,
         cat.description AS tipo_programa
  FROM public.program_editions pe
  JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
  JOIN public.programs p ON p.program_id = pv.program_id
  LEFT JOIN public.catalog cat ON cat.catalog_id = p.cat_type_program
  WHERE p.program_name ILIKE '%FINANCIERO%'
    AND EXTRACT(year FROM pe.start_date) = 2026
    AND EXTRACT(month FROM pe.start_date) = 10
  ORDER BY pe.start_date`)
console.log('\n=== program_editions PLAN FINANCIERO oct-2026 ===')
console.table(ediciones.rows)

if (ediciones.rows.length) {
  const ids = ediciones.rows.map(r => r.edition_num_id)
  const enVista = await q(`
    SELECT * FROM public.v_dashboard_program_goals
    WHERE edition_num_id = ANY($1)`, [ids])
  console.log('\n=== filas en v_dashboard_program_goals para esos edition_num_id ===')
  console.table(enVista.rows)
}

await pool.end()
