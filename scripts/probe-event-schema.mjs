// Sondeo del estado de los objetos que usa el modulo Fundacion > Eventos.
// Responde tres cosas: que columnas existen ya, si hay ediciones que el selector
// pueda listar, y con que tipo estan cargados los congresos.
//
//   node scripts/probe-event-schema.mjs
import { q, pool } from './db.mjs'

const show = (titulo, rows) => {
  console.log(`\n=== ${titulo} (${rows.length}) ===`)
  console.table(rows)
}

try {
  show('Columnas de recursos en program_editions', (await q(`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'program_editions'
       AND column_name IN ('banner_image','banner_mime','banner_link','certificate_form_link',
                           'business_card_link','session_detail_virtual','session_detail_onsite','whatsapp_link')
     ORDER BY column_name`)).rows)

  show('Columnas de event_category_prices', (await q(`
    SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = 'event_category_prices' ORDER BY ordinal_position`)).rows)

  show('Tipos de programa en el catalogo', (await q(`
    SELECT c.catalog_id, c.alias, c.description
      FROM public.catalog c
      JOIN public.catalog p ON p.catalog_id = c.catalog_parent_id
     WHERE p.alias = 'we_program_type' ORDER BY c.description`)).rows)

  show('Categorias de entrada', (await q(`
    SELECT c.catalog_id, c.alias, c.description
      FROM public.catalog c
      JOIN public.catalog p ON p.catalog_id = c.catalog_parent_id
     WHERE p.alias = 'we_event_category' ORDER BY c.description`)).rows)

  show('Programas cuyo tipo suena a congreso/evento', (await q(`
    SELECT prog.program_id, pv.abbreviation, c.description AS tipo, COUNT(pe.edition_num_id) AS ediciones
      FROM public.programs prog
      JOIN public.catalog c ON c.catalog_id = prog.cat_type_program
      JOIN public.program_versions pv ON pv.program_id = prog.program_id
      LEFT JOIN public.program_editions pe ON pe.program_version_id = pv.program_version_id
     WHERE c.alias = 'we_program_type_event'
        OR c.description ILIKE '%congreso%' OR c.description ILIKE '%evento%'
     GROUP BY prog.program_id, pv.abbreviation, c.description
     ORDER BY pv.abbreviation LIMIT 30`)).rows)
} finally {
  await pool.end()
}
