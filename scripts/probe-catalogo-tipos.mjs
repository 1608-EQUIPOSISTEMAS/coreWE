// Que valores puede tomar TIPO PROGRAM / UNIDAD en la hoja "7. Convenios".
import { q, pool } from './db.mjs'
const { rows: tipos } = await q(`
  SELECT c.catalog_id, c.alias, c.description, COUNT(p.program_id)::int AS programas
    FROM public."catalog" c
    LEFT JOIN public.programs p ON p.cat_type_program = c.catalog_id
   WHERE c.alias LIKE 'we_program_type%'
   GROUP BY 1,2,3 ORDER BY 1`)
console.table(tipos)
const { rows: mods } = await q(`
  SELECT c.catalog_id, c.alias, c.description, COUNT(p.program_id)::int AS programas
    FROM public."catalog" c
    LEFT JOIN public.programs p ON p.cat_model_modality = c.catalog_id
   WHERE c.alias LIKE 'we_modality%'
   GROUP BY 1,2,3 ORDER BY 1`)
console.table(mods)
await pool.end()
