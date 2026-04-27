import 'dotenv/config'
import { pool } from '../src/config/db.js'

const PARENT_PV = 209
const PARENT_ED = 15564

async function main () {
  console.log('=== program_version_structure (hijos del pv padre) ===')
  const { rows: struct } = await pool.query(`
    SELECT pvs.child_program_version_id, pvs.sort_order, pv.abbreviation
    FROM program_version_structure pvs
    JOIN program_versions pv ON pv.program_version_id = pvs.child_program_version_id
    WHERE pvs.parent_program_version_id = $1
    ORDER BY pvs.sort_order
  `, [PARENT_PV])
  console.table(struct)

  console.log('\n=== sp_edition_tree_get(15564) via callProcedureReturningRows ===')
  const { callProcedureReturningRows } = await import('../src/utils/spHelper.js')
  const treeRows = await callProcedureReturningRows(pool, 'public.sp_edition_tree_get', [PARENT_ED])
  console.log('rowcount:', treeRows.length)
  if (treeRows[0]) {
    console.log('keys:', Object.keys(treeRows[0]))
    console.log('row json:', JSON.stringify(treeRows[0], null, 2).slice(0, 4000))
  }

  console.log('\n=== program_editions directos del padre + hijos via sort_order ===')
  const { rows: peAll } = await pool.query(`
    SELECT pe.edition_num_id, pe.program_version_id, pe.global_code, pe.start_date, pe.end_date,
           pv.abbreviation
    FROM program_editions pe
    JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
    WHERE pe.program_version_id IN (
      SELECT child_program_version_id FROM program_version_structure WHERE parent_program_version_id = $1
      UNION SELECT $1
    )
    AND pe.active = 'Y'
    ORDER BY pv.program_version_id, pe.start_date
  `, [PARENT_PV])
  console.table(peAll)

  console.log('\n=== Buscar tabla que vincule edicion padre -> ediciones hijas ===')
  const { rows: parentChildTables } = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND (table_name ILIKE '%edition%tree%' OR table_name ILIKE '%edition%child%' OR table_name ILIKE '%edition%structure%' OR table_name ILIKE '%edition%parent%')
  `)
  console.table(parentChildTables)

  pool.end()
}
main().catch(e => { console.error(e); pool.end() })
