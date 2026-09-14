// Por que el badge AULA del cronograma no cuadra con lo que suma el usuario.
// Tres causas posibles, y el script las separa:
//   1. cnt_aula EXCLUYE becas (regla de gerencia: el becado ocupa asiento, no factura).
//   2. el 1er curso de un paquete se sienta aca pero su VENTA cuenta en la fila del padre.
//   3. una venta del padre cuyos modulos corren en OTRA cohorte: suma en la fila
//      del padre y no ocupa asiento aca (dato mal cargado, no un bug del contador).
// Uso: DATABASE_URL=<prod|dev> node scripts/probe-aula-edicion.mjs <edicion_aula> [edicion_padre]
import { pool } from './db.mjs'
import { EditionRepository } from '../src/modules/edition/edition.repository.js'

const AULA = Number(process.argv[2])
const PADRE = Number(process.argv[3])
if (!AULA) throw new Error('falta el edition_num_id del aula')

const [c] = await new EditionRepository(pool).classroomChannelMetricsList([AULA])
console.log('canales:', c)
console.log('VEN+SEG+B2B+MEM =', c.cnt_ventas + c.cnt_segui + c.cnt_b2b + c.cnt_memb,
            '| badge AULA (sin becas) =', c.cnt_aula,
            '| lista del aula (con becas) =', c.cnt_total)

const becas = await pool.query(`
  SELECT e.enrollment_id, TRIM(concat_ws(' ', per.first_name, per.last_name)) AS alumno,
         e.parent_enrollment_id AS padre, LEFT(COALESCE(par.notes, e.notes), 70) AS notas
    FROM enrollments e
    JOIN customers cu ON cu.customer_id = e.customer_id
    JOIN persons per ON per.person_id = cu.person_id
    JOIN catalog cf ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
    LEFT JOIN enrollments par ON par.enrollment_id = e.parent_enrollment_id
   WHERE e.program_edition_id = $1 AND e.active = 'Y'
     AND COALESCE(par.total_amount, e.total_amount, 0) = 0
     AND COALESCE(e.cat_b2b_doctype, par.cat_b2b_doctype) IS NULL
     AND COALESCE(par.agent_origin, e.agent_origin, '') NOT ILIKE '%b2b%'
     AND COALESCE(par.membership_program_id, e.membership_program_id) IS NULL
     AND COALESCE(CASE WHEN e.parent_enrollment_id IS NOT NULL THEN par.notes ELSE e.notes END, '') NOT ILIKE '%desde inscripcion #%'
     AND NOT EXISTS (SELECT 1 FROM course_changes cc WHERE cc.enrollment_destination_id = COALESCE(e.parent_enrollment_id, e.enrollment_id))
   ORDER BY e.enrollment_id`, [AULA])
console.log(`\n(1) becas que el badge descuenta (${becas.rowCount}):`)
console.table(becas.rows)

if (!PADRE) { await pool.end(); process.exit(0) }

const ventas = await pool.query(`
  SELECT par.enrollment_id AS venta, TRIM(concat_ws(' ', per.first_name, per.last_name)) AS alumno,
         par.total_amount AS total, par.registration_date::date AS registro,
         (SELECT string_agg(DISTINCT ch.program_edition_id::text, ',') FROM enrollments ch
           WHERE ch.parent_enrollment_id = par.enrollment_id AND ch.active = 'Y') AS ediciones_hijos,
         EXISTS (SELECT 1 FROM enrollments ch WHERE ch.parent_enrollment_id = par.enrollment_id
                   AND ch.active = 'Y' AND ch.program_edition_id = $2) AS ocupa_asiento
    FROM enrollments par
    JOIN customers cu ON cu.customer_id = par.customer_id
    JOIN persons per ON per.person_id = cu.person_id
    JOIN catalog cf ON cf.catalog_id = par.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
   WHERE par.program_edition_id = $1 AND par.active = 'Y'
   ORDER BY par.enrollment_id`, [PADRE, AULA])
console.log(`\n(2/3) ventas de la edicion padre ${PADRE} y donde se sientan:`)
console.table(ventas.rows)
const huerfanas = ventas.rows.filter(r => !r.ocupa_asiento)
if (huerfanas.length) {
  console.log(`OJO: ${huerfanas.length} venta(s) suman en la fila del padre pero no ocupan asiento en el aula ${AULA}:`,
              huerfanas.map(r => `${r.venta} ${r.alumno} (modulos en ${r.ediciones_hijos})`).join(' | '))
}
await pool.end()
