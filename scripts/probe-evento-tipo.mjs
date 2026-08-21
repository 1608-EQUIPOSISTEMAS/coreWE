// One-off: confirmar que los congresos/eventos se distinguen por program_type_alias
// en el cronograma (sp_edition_by_week_list expone cat.alias del programa).
import { q, pool } from './db.mjs'
const { rows } = await q(`
  SELECT pv.abbreviation, c.alias AS program_type_alias, c.description AS program_type,
         count(*) AS ediciones
  FROM program_versions pv
  JOIN programs p ON p.program_id = pv.program_id
  JOIN catalog c ON c.catalog_id = p.cat_type_program
  WHERE pv.abbreviation ILIKE '%CONGRESO%' OR c.alias = 'we_program_type_event'
  GROUP BY 1,2,3 ORDER BY 1 LIMIT 30`)
console.table(rows)
await pool.end()
