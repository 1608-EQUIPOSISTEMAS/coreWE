// Ejercita el guardado del modulo Fundacion > Eventos contra una edicion real,
// sin pasar por HTTP: aisla si el fallo es del backend o del navegador.
//
//   node scripts/probe-event-save.mjs
import { q, pool } from './db.mjs'

try {
  const { rows: eds } = await q(`
    SELECT pe.edition_num_id, pe.program_version_id, pv.abbreviation, pe.active
      FROM public.program_editions pe
      JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
      JOIN public.programs prog ON prog.program_id = pv.program_id
      JOIN public.catalog c ON c.catalog_id = prog.cat_type_program
     WHERE c.alias = 'we_program_type_event'
     ORDER BY pe.start_date DESC NULLS LAST`)
  console.log('\n=== Ediciones de evento ==='); console.table(eds)
  if (!eds.length) { console.log('No hay ediciones: nada que probar.'); process.exit(0) }

  const ed = eds[0]

  // 1) El UPDATE de recursos, tal cual lo arma saveEventResources.
  const upd = await q(
    `UPDATE public.program_editions SET business_card_link = business_card_link WHERE edition_num_id = $1`,
    [ed.edition_num_id])
  console.log(`\nUPDATE recursos sobre ${ed.edition_num_id}: ${upd.rowCount} fila(s)`)

  // 2) El upsert de categorias, con ROLLBACK: solo interesa saber si la
  //    sentencia es valida, no dejar datos de prueba en produccion.
  const { rows: cats } = await q(`
    SELECT c.catalog_id FROM public.catalog c
      JOIN public.catalog p ON p.catalog_id = c.catalog_parent_id
     WHERE p.alias = 'we_event_category' AND c.active = 'Y' ORDER BY c.description`)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const c of cats) {
      await client.query(`
        INSERT INTO public.event_category_prices
          (program_version_id, cat_event_category, active, price_student_soles,
           price_student_dollars, price_profesional_soles, price_profesional_dollars, whatsapp_link)
        VALUES ($1, $2, 'Y', 1, 1, 1, 1, 'https://prueba')
        ON CONFLICT (program_version_id, cat_event_category) DO UPDATE
          SET active = EXCLUDED.active, whatsapp_link = EXCLUDED.whatsapp_link`,
      [ed.program_version_id, c.catalog_id])
    }
    console.log(`Upsert de ${cats.length} categorias sobre version ${ed.program_version_id}: OK`)
    await client.query('ROLLBACK')
    console.log('ROLLBACK hecho: no quedo nada escrito.')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('FALLO el upsert de categorias:', e.code, e.message)
  } finally {
    client.release()
  }
} finally {
  await pool.end()
}
