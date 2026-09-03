// Sondeo (2026-09-03): estado de 18197 y candidatos de cohorte para sus hijos SEG.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const bak = fs.readFileSync(path.join(raiz, '.env.bak-produccion'), 'utf8')
process.env.DATABASE_URL = bak.match(/^DATABASE_URL=(.+)$/m)[1].trim()
const { pool, query: q } = await import('../src/shared/db/pool.js')

const { rows: padre } = await q(
  `SELECT e.enrollment_id, e.program_version_id, pv.abbreviation, e.program_edition_id,
          e.total_amount, e.active, c.description estado, e.notes,
          p.first_name, p.last_name, p.mother_last_name
     FROM enrollments e
     LEFT JOIN program_versions pv ON pv.program_version_id=e.program_version_id
     LEFT JOIN catalog c ON c.catalog_id=e.cat_type_status
     LEFT JOIN customers cu ON cu.customer_id=e.customer_id LEFT JOIN persons p ON p.person_id=cu.person_id
    WHERE e.enrollment_id=18197`)
console.log('--- padre ---'); console.table(padre)

const pvid = padre[0]?.program_version_id
const { rows: hijos } = await q('SELECT enrollment_id FROM enrollments WHERE parent_enrollment_id=18197')
console.log('hijos:', hijos.length)
const { rows: val } = await q('SELECT * FROM enrollment_validations WHERE enrollment_id=18197')
console.log('validaciones:', val.length)

const { rows: estr } = await q(
  `SELECT s.child_program_version_id pv, pv.abbreviation
     FROM program_version_structure s JOIN program_versions pv ON pv.program_version_id=s.child_program_version_id
    WHERE s.parent_program_version_id=$1`, [pvid])
console.log('--- modulos del paquete ---'); console.table(estr)

const { rows: cohortes } = await q(
  `SELECT p.program_edition_id cohorte, pe.global_code, pe.start_date::date ini,
          count(DISTINCT p.enrollment_id) padres, count(h.enrollment_id) hijos,
          string_agg(DISTINCT hpv.abbreviation||' '||hpe.start_date::date, ' | ') mods
     FROM enrollments p
     JOIN program_editions pe ON pe.edition_num_id=p.program_edition_id
     LEFT JOIN enrollments h ON h.parent_enrollment_id=p.enrollment_id AND h.active='Y'
     LEFT JOIN program_versions hpv ON hpv.program_version_id=h.program_version_id
     LEFT JOIN program_editions hpe ON hpe.edition_num_id=h.program_edition_id
    WHERE p.program_version_id=$1 AND p.active='Y'
    GROUP BY 1,2,3 ORDER BY 3 DESC NULLS LAST`, [pvid])
console.log('--- cohortes del mismo paquete ---'); console.dir(cohortes, { depth: null })
await pool.end()
