// One-off: por que AULA no cuadra con VENTAS+SEGUI+B2B+MEMB+BECA en el cronograma.
// Lista el roster elegible de una edicion con lo que decide el bucket comercial.
//   node scripts/diagnostico-cronograma-cuadre.mjs 15100 15606 15611
import { q, pool } from './db.mjs'
import { EditionRepository } from '../src/modules/edition/edition.repository.js'

const ids = process.argv.slice(2).map(Number)
const repo = new EditionRepository(pool)

const detalle = async (id) => (await q(`
  SELECT e.enrollment_id, e.parent_enrollment_id AS padre,
         TRIM(concat_ws(' ', per.first_name, per.last_name)) AS alumno,
         cts.alias AS estado, e.total_amount, e.cat_b2b_doctype IS NOT NULL AS b2b,
         e.membership_program_id AS memb, e.agent_origin,
         (NOT EXISTS (SELECT 1 FROM enrollments ch WHERE ch.parent_enrollment_id = e.enrollment_id)) AS hoja,
         ppar.program_name AS programa_padre, ppe.edition_num_id AS edicion_padre,
         ppe.start_date::date AS inicio_padre,
         (SELECT count(*) FROM enrollments sib
            JOIN program_editions pesib ON pesib.edition_num_id = sib.program_edition_id
           WHERE sib.parent_enrollment_id = e.parent_enrollment_id
             AND sib.enrollment_id <> e.enrollment_id
             AND (pesib.start_date, pesib.edition_num_id) < (pe_e.start_date, pe_e.edition_num_id)
         ) AS hermanos_antes
    FROM enrollments e
    JOIN catalog cf ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
    LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
    JOIN customers cust ON cust.customer_id = e.customer_id
    JOIN persons per ON per.person_id = cust.person_id
    JOIN program_editions pe_e ON pe_e.edition_num_id = e.program_edition_id
    LEFT JOIN enrollments par ON par.enrollment_id = e.parent_enrollment_id
    LEFT JOIN catalog parcts ON parcts.catalog_id = par.cat_type_status
    LEFT JOIN program_versions ppv ON ppv.program_version_id = par.program_version_id
    LEFT JOIN programs ppar ON ppar.program_id = ppv.program_id
    LEFT JOIN program_editions ppe ON ppe.edition_num_id = par.program_edition_id
   WHERE e.program_edition_id = $1 AND e.active='Y'
     AND (cts.alias IS NULL OR cts.alias NOT IN ('we_enrollment_status_retired',
          'we_enrollment_status_course_changed','we_enrollment_status_reprogrammed'))
     AND (parcts.alias IS NULL OR parcts.alias <> 'we_enrollment_status_reprogrammed')
   ORDER BY e.enrollment_id`, [id])).rows

const metricas = await repo.classroomChannelMetricsList(ids)
for (const id of ids) {
  const m = metricas.find(x => x.edition_num_id === id) || {}
  const comercial = (m.cnt_ventas||0)+(m.cnt_segui||0)+(m.cnt_b2b||0)+(m.cnt_memb||0)+(m.cnt_becas||0)
  console.log(`\n=== edicion ${id} | VEN ${m.cnt_ventas||0} SEG ${m.cnt_segui||0} B2B ${m.cnt_b2b||0} MEM ${m.cnt_memb||0} BEC ${m.cnt_becas||0} => ${comercial} | AULA ${m.cnt_aula||0} total ${m.cnt_total||0}`)
  console.table(await detalle(id))
}
await pool.end()
