// Sondeo (2026-09-01): enrollment 2625, padre de paquete sin hijos SEG.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const respaldo = fs.readFileSync(path.join(raiz, '.env.bak-produccion'), 'utf8')
process.env.DATABASE_URL = respaldo.match(/^DATABASE_URL=(.+)$/m)[1].trim()
process.env.DATABASE_URL_DIRECT = process.env.DATABASE_URL
const { pool, query: q } = await import('../src/shared/db/pool.js')

const ID = Number(process.argv[2] || 2625)
const { rows: [db] } = await q('SELECT current_database() AS db, inet_server_port() AS port')
console.log('BD:', db)

const { rows: padre } = await q(
  `SELECT e.enrollment_id, e.customer_id, p.first_name, p.last_name, p.mother_last_name, p.document_number,
          e.program_version_id, pv.abbreviation AS programa,
          e.program_edition_id, pe.global_code AS edicion, pe.start_date::date AS ini,
          e.parent_enrollment_id, e.total_amount, e.cat_payment_plan,
          cs.description AS estado, ct.description AS tipo_pago,
          e.registration_date::date AS f_reg, e.notes
     FROM enrollments e
     LEFT JOIN customers cu ON cu.customer_id = e.customer_id
     LEFT JOIN persons p ON p.person_id = cu.person_id
     LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
     LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
     LEFT JOIN catalog cs ON cs.catalog_id = e.cat_type_status
     LEFT JOIN catalog ct ON ct.catalog_id = e.cat_payment_plan
    WHERE e.enrollment_id = $1`, [ID])
console.log('--- padre ---'); console.dir(padre, { depth: null })

const { rows: hijos } = await q(
  `SELECT enrollment_id, program_version_id, program_edition_id, cat_type_status, total_amount
     FROM enrollments WHERE parent_enrollment_id = $1`, [ID])
console.log('--- hijos ---'); console.table(hijos)

const { rows: val } = await q('SELECT * FROM enrollment_validations WHERE enrollment_id = $1', [ID])
console.log('--- validaciones ---'); console.table(val)

if (padre[0]) {
  const { rows: est } = await q(
    `SELECT s.child_program_version_id AS pv, pv.abbreviation
       FROM program_version_structure s
       JOIN program_versions pv ON pv.program_version_id = s.child_program_version_id
      WHERE s.parent_program_version_id = $1`, [padre[0].program_version_id])
  console.log('--- modulos del paquete ---'); console.table(est)
}
await pool.end()
