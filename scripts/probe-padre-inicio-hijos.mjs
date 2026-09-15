// Sondeo: la consulta real de findEditionSchedule (correo de confirmacion) sobre
// un padre con fecha, un padre sin fecha propia y un hijo. Solo BD local.
import pg from 'pg'
const db = new pg.Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/system_erp_dev' })
await db.connect()
const hijo = (await db.query(`SELECT enrollment_id FROM enrollments WHERE parent_enrollment_id = 16624 LIMIT 1`)).rows[0].enrollment_id
for (const id of [16624, 15799, hijo]) {
  const { rows } = await db.query(`
      SELECT COALESCE(NULLIF(dayc.variable_3, ''), dayc.description) AS frequency,
             hourc.description AS schedule,
             (SELECT MIN(ce.start_date)
              FROM edition_structure es
              JOIN program_editions ce ON ce.edition_num_id = es.child_edition_id
              WHERE es.parent_edition_id = pe.edition_num_id) AS first_module_start_date
      FROM program_editions pe
      LEFT JOIN catalog dayc  ON dayc.catalog_id  = pe.cat_day_combination_id
      LEFT JOIN catalog hourc ON hourc.catalog_id = pe.cat_hour_combination_id
      WHERE pe.edition_num_id = COALESCE($2::integer, (SELECT program_edition_id FROM enrollments WHERE enrollment_id = $1))
  `, [id, null])
  console.log(id, rows[0])
}
await db.end()
