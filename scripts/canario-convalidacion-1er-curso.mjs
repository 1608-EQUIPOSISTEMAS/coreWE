// Canario: un paquete con modulo CONVALIDADO no tiene "1er curso" que descontar.
//
// El modulo convalidado ya se curso antes y NO genera enrollment hijo, asi que el
// hijo mas temprano que si existe es SEGUIMIENTO, no la venta. Si alguien quita
// esa excepcion de classroomChannelMetricsList, esos alumnos se quedan sin canal
// y la fila del cronograma deja de cuadrar con su AULA (caso AIMEE / 14048,
// SAP HANA EWM ED 15627: AULA 11 contra 10 en los canales).
//
//   node scripts/canario-convalidacion-1er-curso.mjs
import { EditionRepository } from '../src/modules/edition/edition.repository.js'
import { q, pool } from './db.mjs'

// Solo se puede exigir "canales == AULA" en ediciones SIN 1er curso legitimo: ahi
// el descuento de canal es correcto y la fila descuadra a proposito.
const { rows } = await q(`
  WITH elegible AS (
    SELECT e.enrollment_id, e.parent_enrollment_id, e.program_edition_id AS ed,
           pe.start_date, pe.edition_num_id,
           EXISTS (SELECT 1 FROM public.enrollment_validations ev
                    WHERE ev.enrollment_id = e.parent_enrollment_id
                      AND ev.validation_type <> 'edition_override') AS convalidado
      FROM public.enrollments e
      JOIN public.enrollments par ON par.enrollment_id = e.parent_enrollment_id
      JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
      JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
      LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
     WHERE e.active = 'Y'
       AND par.program_edition_id IS NOT NULL
       AND cf.alias = 'we_enrollment_status_checked'
       AND (cts.alias IS NULL OR cts.alias NOT IN (
              'we_enrollment_status_retired',
              'we_enrollment_status_course_changed',
              'we_enrollment_status_reprogrammed'))
  ),
  primero AS (
    SELECT h.*, NOT EXISTS (
             SELECT 1 FROM elegible sib
              WHERE sib.parent_enrollment_id = h.parent_enrollment_id
                AND sib.enrollment_id <> h.enrollment_id
                AND (sib.start_date, sib.edition_num_id) < (h.start_date, h.edition_num_id)
           ) AS es_primero
      FROM elegible h
  )
  SELECT ed AS edition_num_id
    FROM primero
   GROUP BY ed
  HAVING bool_or(convalidado)                          -- hay hijo de paquete convalidado
     AND NOT bool_or(es_primero AND NOT convalidado)   -- y ningun 1er curso legitimo`)

const ids = rows.map(r => r.edition_num_id)
const metricas = await new EditionRepository(pool).classroomChannelMetricsList(ids)
const descuadres = metricas.filter(m =>
  m.cnt_ventas + m.cnt_segui + m.cnt_memb + m.cnt_b2b !== m.cnt_aula)

console.log(`Ediciones evaluadas: ${ids.length} -> ${ids.join(', ') || '(ninguna)'}`)
if (descuadres.length) {
  console.error('DESCUADRE: canales != AULA (se perdio el canal de un hijo convalidado)')
  console.table(descuadres)
} else {
  console.log('OK: en todas, VEN+SEG+MEM+B2B == AULA')
}
await pool.end()
process.exit(descuadres.length ? 1 : 0)
