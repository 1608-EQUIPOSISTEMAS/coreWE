import { pool } from './db/pool.js'

// Cursos hijos de una venta de paquete (diplomado/especializacion): la fila
// padre lleva el precio y el estado, y cada hijo es un curso con su propia
// edicion y fecha de inicio. El listado de FICO los muestra como CURSO n / FI n,
// igual que la hoja de calculo que reemplaza.
//
// Vive fuera del stored procedure a proposito, mismo motivo que
// event-category.js: sp_fico_enrollment_list lee la matview
// mv_enrollment_report_system, que es una fila por inscripcion y no conoce el
// arbol. Una consulta extra por pagina (25 filas) sale mas barato que un
// LATERAL agregando sobre la matview entera.
//
// ponytail: si el arbol hace falta en mas sitios, este modulo es el sitio donde
// crece; no duplicar la query en cada repositorio.

// La edicion puede ser NULL (productos online, que no tienen program_editions):
// esos hijos van sin fecha, no se descartan.
const SQL = `
  SELECT h.parent_enrollment_id,
         h.enrollment_id,
         COALESCE(NULLIF(TRIM(pv.abbreviation), ''), pr.program_name) AS course_name,
         pr.program_name  AS course_full_name,
         pe.specific_code AS edition_code,
         TO_CHAR(pe.start_date, 'DD/MM/YYYY') AS start_date
    FROM public.enrollments h
    JOIN public.program_versions pv ON pv.program_version_id = h.program_version_id
    JOIN public.programs pr         ON pr.program_id = pv.program_id
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = h.program_edition_id
   WHERE h.parent_enrollment_id = ANY($1::int[])
     AND h.active = 'Y'
   ORDER BY h.parent_enrollment_id, pe.start_date NULLS LAST, h.enrollment_id
`

// Agrega children[] (ordenado por fecha de inicio) a cada fila que sea padre.
// Muta y devuelve las filas recibidas.
// Nunca lanza: es informacion de apoyo, no debe tumbar el listado completo.
export async function attachChildCourses (rows, db = pool) {
  const list = Array.isArray(rows) ? rows : [rows]
  const ids = [...new Set(
    list.map(r => Number(r?.enrollment_id)).filter(Number.isInteger)
  )]
  if (!ids.length) return rows

  try {
    const { rows: found } = await db.query(SQL, [ids])
    if (!found.length) return rows
    const byParent = new Map()
    for (const child of found) {
      const key = Number(child.parent_enrollment_id)
      if (!byParent.has(key)) byParent.set(key, [])
      byParent.get(key).push({
        enrollment_id: child.enrollment_id,
        course_name:   child.course_name,
        course_full_name: child.course_full_name,
        edition_code:  child.edition_code,
        start_date:    child.start_date
      })
    }
    for (const row of list) {
      const children = byParent.get(Number(row?.enrollment_id))
      if (children) row.children = children
    }
  } catch (err) {
    console.error('[attachChildCourses] no se pudieron resolver los hijos:', err.message)
  }
  return rows
}
