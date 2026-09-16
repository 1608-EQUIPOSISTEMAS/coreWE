// Solo lectura. Decide si el nombre del correo de confirmacion de un enrollment
// viene mal cargado en Producto (brand_name de la version) o si el enrollment
// apunta a la version equivocada (error del sistema).
//   node scripts/probe-nombre-correo-18963.mjs [enrollment_id]
import { q, pool } from './db.mjs'

const enrollmentId = Number(process.argv[2] || 18963)

try {
  const { rows: [db] } = await q('SELECT current_database() AS db')
  console.log('BD:', db.db)

  const { rows: [e] } = await q(`
    SELECT e.enrollment_id, e.program_version_id, e.program_edition_id, e.parent_enrollment_id,
           pv.version_code, pv.abbreviation, pv.brand_name, pv.program_id,
           prog.cat_model_modality, c_mod.description AS modalidad,
           pe.edition_num_id, pe.program_version_id AS edition_version_id,
           pv_ed.abbreviation AS edition_abbreviation, pv_ed.brand_name AS edition_brand_name
    FROM enrollments e
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN programs prog ON prog.program_id = pv.program_id
    LEFT JOIN catalog c_mod ON c_mod.catalog_id = prog.cat_model_modality
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN program_versions pv_ed ON pv_ed.program_version_id = pe.program_version_id
    WHERE e.enrollment_id = $1`, [enrollmentId])
  console.log('\nEnrollment:', e)

  // Todas las versiones que comparten el brand_name que salio en el correo, o
  // que se parecen al programa: muestra si Producto copio el nombre de otra.
  const { rows: gemelas } = await q(`
    SELECT pv.program_version_id, pv.version_code, pv.abbreviation, pv.brand_name,
           prog.program_id, c_mod.description AS modalidad
    FROM program_versions pv
    JOIN programs prog ON prog.program_id = pv.program_id
    LEFT JOIN catalog c_mod ON c_mod.catalog_id = prog.cat_model_modality
    WHERE pv.brand_name = $1 OR pv.abbreviation ILIKE '%HANA%'
    ORDER BY pv.program_version_id`, [e?.brand_name])
  console.table(gemelas)
} finally {
  await pool.end()
}
