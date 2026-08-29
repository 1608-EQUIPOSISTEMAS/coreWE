// Sonda one-off: padre 9940, sus hijos, su estructura y el arbol de su edicion.
// Usa la BD del .env (local) salvo que se pase --prod.
const { q, pool } = process.argv.includes('--prod')
  ? await import('./_prod.mjs')
  : await import('./db.mjs')

const EID = 9940

const { rows: padre } = await q(`
  SELECT e.enrollment_id, e.customer_id, e.program_version_id AS pv, e.program_edition_id AS ed,
         e.parent_enrollment_id, c.description AS estado, e.total_amount, e.registration_date,
         e.active, e.notes, pe.global_code, pv.abbreviation AS programa
    FROM enrollments e
    LEFT JOIN catalog c ON c.catalog_id = e.cat_type_status
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
   WHERE e.enrollment_id = $1`, [EID])
console.log('--- padre ---'); console.table(padre)

const { rows: alumno } = await q(`
  SELECT per.person_id, per.first_name, per.last_name, per.document_number
    FROM enrollments e JOIN customers cu ON cu.customer_id = e.customer_id
    JOIN persons per ON per.person_id = cu.person_id WHERE e.enrollment_id=$1`, [EID])
console.log('--- alumno ---'); console.table(alumno)

const { rows: hijos } = await q(`
  SELECT e.enrollment_id, e.program_version_id, e.program_edition_id, e.total_amount,
         c.description AS estado, pe.global_code
    FROM enrollments e
    LEFT JOIN catalog c ON c.catalog_id = e.cat_type_status
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
   WHERE e.parent_enrollment_id = $1 ORDER BY e.enrollment_id`, [EID])
console.log('--- hijos ---'); console.table(hijos)

const { rows: est } = await q(`
  SELECT pvs.child_program_version_id AS child_pv, pvs.sort_order, pv.abbreviation,
         EXISTS (SELECT 1 FROM program_editions pe WHERE pe.program_version_id = pvs.child_program_version_id) AS tiene_ediciones
    FROM program_version_structure pvs
    JOIN program_versions pv ON pv.program_version_id = pvs.child_program_version_id
   WHERE pvs.parent_program_version_id = (SELECT program_version_id FROM enrollments WHERE enrollment_id=$1)
   ORDER BY pvs.sort_order`, [EID])
console.log('--- estructura del paquete ---'); console.table(est)

const { rows: val } = await q('SELECT * FROM enrollment_validations WHERE enrollment_id=$1', [EID])
console.log('--- validaciones ---'); console.table(val)

const edId = padre[0]?.ed
if (edId) {
  const { rows: tree } = await q('SELECT * FROM public.sp_edition_tree_get($1)', [edId]).catch(e => ({ rows: [{ error: e.message }] }))
  console.log('--- arbol de la edicion del padre ---')
  console.dir(tree, { depth: 4 })
}
await pool.end()
