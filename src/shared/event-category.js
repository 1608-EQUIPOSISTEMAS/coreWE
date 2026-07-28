import { pool } from './db/pool.js'

// Categoria de entrada de eventos/congresos (VIP/GENERAL/PREMIUM/VIRTUAL).
//
// Vive fuera de los stored procedures a proposito: enrollments.cat_event_category
// se agrego despues de sp_comercial_enrollment_get, sp_fico_enrollment_list y la
// matview mv_enrollment_report_system, y ninguno la expone. En vez de reescribir
// tres SPs se enriquecen las filas ya devueltas con una sola consulta extra.
//
// ponytail: si algun dia esos SPs empiezan a devolver el campo, borrar este
// modulo y sus llamadas — el frontend ya lee las mismas tres propiedades.

const SQL = `
  SELECT e.enrollment_id,
         e.cat_event_category,
         c.alias       AS event_category_alias,
         c.description AS event_category_label
    FROM public.enrollments e
    JOIN public.catalog c ON c.catalog_id = e.cat_event_category
   WHERE e.enrollment_id = ANY($1::int[])
`

// Agrega event_category_label / _alias / cat_event_category a cada fila que
// tenga enrollment_id. Muta y devuelve las filas recibidas.
// Nunca lanza: es informacion de apoyo, no debe tumbar el detalle completo si
// la tabla o la columna todavia no existen en ese ambiente.
export async function attachEventCategory (rows, db = pool) {
  const list = Array.isArray(rows) ? rows : [rows]
  const ids = [...new Set(
    list.map(r => Number(r?.enrollment_id)).filter(Number.isInteger)
  )]
  if (!ids.length) return rows

  try {
    const { rows: found } = await db.query(SQL, [ids])
    if (!found.length) return rows
    const byId = new Map(found.map(r => [Number(r.enrollment_id), r]))
    for (const row of list) {
      const hit = byId.get(Number(row?.enrollment_id))
      if (!hit) continue
      row.cat_event_category   = hit.cat_event_category
      row.event_category_alias = hit.event_category_alias
      row.event_category_label = hit.event_category_label
    }
  } catch (err) {
    console.error('[attachEventCategory] no se pudo resolver la categoria:', err.message)
  }
  return rows
}

// Un congreso no se dicta en el campus: no hay curso en Odoo al que inscribir,
// ni cuotas que activar, ni credenciales que entregar. Lo unico que recibe el
// asistente es el correo de confirmacion.
//
// Se pregunta por DOS vias, igual que email-confirmation.render.js: la
// categoria de entrada (que solo tienen los eventos) o el tipo de programa.
// Basta cualquiera de las dos.
const IS_EVENT_SQL = `
  SELECT (e.cat_event_category IS NOT NULL OR c_type.alias = 'we_program_type_event') AS is_event
    FROM public.enrollments e
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.programs prog ON prog.program_id = pv.program_id
    LEFT JOIN public.catalog c_type ON c_type.catalog_id = prog.cat_type_program
   WHERE e.enrollment_id = $1
`

// Ante la duda devuelve false: saltarse Odoo por error dejaria una inscripcion
// de curso sin alumno en el campus, que es mucho peor que crear uno de mas.
export async function isEventEnrollment (enrollmentId, db = pool) {
  const id = Number(enrollmentId)
  if (!Number.isInteger(id)) return false
  try {
    const { rows } = await db.query(IS_EVENT_SQL, [id])
    return rows?.[0]?.is_event === true
  } catch (err) {
    console.error('[isEventEnrollment] no se pudo determinar si es evento:', err.message)
    return false
  }
}
