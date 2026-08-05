// Sondeo: inscripciones con agent_origin = 'WE' (canal WE sin area TWE/FWE).
// Sirve para decidir el backfill a 'FWE' de las ventas de Fundacion.
import { q, pool } from './db.mjs'

const { rows: resumen } = await q(`
  SELECT e.agent_origin, COUNT(*) AS n,
         MIN(e.registration_date)::date AS desde,
         MAX(e.registration_date)::date AS hasta
    FROM enrollments e
   WHERE e.agent_origin IS NOT NULL
   GROUP BY 1 ORDER BY 2 DESC
`)
console.table(resumen)

const { rows: detalle } = await q(`
  SELECT e.enrollment_id, e.registration_date::date AS fecha,
         pv.abbreviation AS abrev, p.program_name AS programa,
         pe2.document_number AS doc, e.active
    FROM enrollments e
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN program_versions pv ON pv.program_version_id = COALESCE(e.program_version_id, pe.program_version_id)
    LEFT JOIN programs p ON p.program_id = pv.program_id
    LEFT JOIN customers c ON c.customer_id = e.customer_id
    LEFT JOIN persons pe2 ON pe2.person_id = c.person_id
   WHERE e.agent_origin = 'WE'
   ORDER BY e.registration_date DESC
`)
console.log(`\nWE genericas: ${detalle.length}`)
console.table(detalle.slice(0, 60))

await pool.end()
