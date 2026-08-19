// One-off: escaneo del cronograma de un mes. Por cada edicion compara la suma
// comercial (VEN+SEG+B2B+MEM+BEC) contra el AULA y descompone la brecha, para
// separar lo esperado (1er curso de paquete: su venta vive en el padre) de un
// descuadre real (venta o alumno que no aparece en NINGUNA fila del cronograma).
//   node scripts/diagnostico-cronograma-mes.mjs 2026-08
import { q, pool } from './db.mjs'
import { EditionRepository } from '../src/modules/edition/edition.repository.js'

const mes = process.argv[2] || '2026-08'
const repo = new EditionRepository(pool)

const { rows: eds } = await q(`
  SELECT pe.edition_num_id AS id, p.program_name AS programa, pe.specific_code AS cod,
         pe.start_date::date AS inicio
    FROM program_editions pe
    JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN programs p ON p.program_id = pv.program_id
   WHERE pe.active = 'Y' AND to_char(pe.start_date, 'YYYY-MM') = $1
   ORDER BY pe.start_date, p.program_name`, [mes])

const ids = eds.map(e => e.id)
const metricas = await repo.classroomChannelMetricsList(ids)
const byId = Object.fromEntries(metricas.map(m => [m.edition_num_id, m]))

// Composicion del roster elegible (misma elegibilidad que el repo): hojas,
// padres y hojas cuya venta vive en el padre (1er curso del paquete).
const { rows: comp } = await q(`
  WITH elegible AS (
    SELECT e.enrollment_id, e.program_edition_id AS ed, e.parent_enrollment_id AS padre,
           par.program_edition_id AS ed_padre,
           (NOT EXISTS (SELECT 1 FROM enrollments ch WHERE ch.parent_enrollment_id = e.enrollment_id)) AS hoja,
           pe_e.start_date, pe_e.edition_num_id
      FROM enrollments e
      JOIN catalog cf ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
      LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
      JOIN program_editions pe_e ON pe_e.edition_num_id = e.program_edition_id
      LEFT JOIN enrollments par ON par.enrollment_id = e.parent_enrollment_id
      LEFT JOIN catalog parcts ON parcts.catalog_id = par.cat_type_status
     WHERE e.program_edition_id = ANY($1::int[]) AND e.active = 'Y'
       AND (cts.alias IS NULL OR cts.alias NOT IN ('we_enrollment_status_retired',
            'we_enrollment_status_course_changed','we_enrollment_status_reprogrammed'))
       AND (parcts.alias IS NULL OR parcts.alias <> 'we_enrollment_status_reprogrammed')
  )
  SELECT ed,
         count(*) FILTER (WHERE hoja)::int AS hojas,
         count(*) FILTER (WHERE NOT hoja)::int AS padres,
         count(*) FILTER (WHERE hoja AND padre IS NOT NULL AND ed_padre IS NOT NULL
                            AND NOT EXISTS (
                              SELECT 1 FROM enrollments sib
                                JOIN program_editions ps ON ps.edition_num_id = sib.program_edition_id
                               WHERE sib.parent_enrollment_id = elegible.padre
                                 AND sib.enrollment_id <> elegible.enrollment_id
                                 AND (ps.start_date, ps.edition_num_id) < (elegible.start_date, elegible.edition_num_id)))::int
           AS primer_curso
    FROM elegible GROUP BY ed`, [ids])
const compById = Object.fromEntries(comp.map(c => [c.ed, c]))

const filas = []
for (const e of eds) {
  const m = byId[e.id] || {}
  const c = compById[e.id] || { hojas: 0, padres: 0, primer_curso: 0 }
  const comercial = (m.cnt_ventas||0)+(m.cnt_segui||0)+(m.cnt_b2b||0)+(m.cnt_memb||0)+(m.cnt_becas||0)
  const aula = m.cnt_total || 0                       // hojas, becas incluidas
  const brecha = aula - comercial
  // esperado: cada 1er curso suma al aula sin sumar comercial; cada padre suma
  // comercial sin sumar aula. Si la identidad falla, hay algo mas.
  const esperado = c.primer_curso - c.padres
  filas.push({ id: e.id, programa: e.programa.slice(0, 34), cod: e.cod,
    inicio: String(e.inicio).slice(0,10), comercial, aula, brecha,
    '1er_curso': c.primer_curso, padres: c.padres, esperado,
    ok: brecha === esperado ? '' : '  <-- REVISAR' })
}
console.table(filas)

// Descuadres GLOBALES: cosas que no aparecen en NINGUNA fila del cronograma.
const { rows: huerf } = await q(`
  SELECT 'venta sin edicion (E0/suelta)' AS caso, e.enrollment_id, e.registration_date::date,
         p.program_name, e.total_amount
    FROM enrollments e
    JOIN catalog cf ON cf.catalog_id = e.cat_fico_status AND cf.alias='we_enrollment_status_checked'
    LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
    JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    JOIN programs p ON p.program_id = pv.program_id
   WHERE e.active='Y' AND e.program_edition_id IS NULL
     AND (cts.alias IS NULL OR cts.alias NOT IN ('we_enrollment_status_retired',
          'we_enrollment_status_course_changed','we_enrollment_status_reprogrammed'))
     AND to_char(e.registration_date,'YYYY-MM') = $1
   ORDER BY e.enrollment_id`, [mes])
console.log(`\nVentas/alumnos sin program_edition_id registrados en ${mes} (no salen en ninguna fila):`, huerf.length)
if (huerf.length) console.table(huerf)
await pool.end()
