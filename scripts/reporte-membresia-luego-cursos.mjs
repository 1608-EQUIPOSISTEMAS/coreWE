// Alumnos que compraron MEMBRESIA y DESPUES compraron cursos EN VIVO pagando aparte.
//
// Ojo: la membresia ya incluye cursos, y esos entran con total_amount = 0. Para
// "compro membresia y luego compro cursos" solo cuentan los enrollments con monto > 0
// y sin padre (los hijos de paquete siempre van en 0 / SEG).
//
// Uso: node scripts/reporte-membresia-luego-cursos.mjs [desde] [hasta]
import { q, pool } from './db.mjs'

const desde = process.argv[2] || '2026-06-01'
const hasta = process.argv[3] || '2026-07-01'

const { rows } = await q(`
  WITH memb AS (
    SELECT e.customer_id,
           min(e.registration_date) AS fecha_memb,
           min(pr.program_name)     AS membresia
      FROM enrollments e
      JOIN program_versions pv USING (program_version_id)
      JOIN programs pr         USING (program_id)
     WHERE pr.is_membership
       AND e.active = 'Y'
       AND e.registration_date >= $1 AND e.registration_date < $2
     GROUP BY e.customer_id
  )
  SELECT m.customer_id,
         concat_ws(' ', pe.first_name, pe.last_name, pe.mother_last_name) AS alumno,
         pe.document_number AS doc,
         replace(m.membresia, 'MEMBRESIA ', '') AS membresia,
         m.fecha_memb,
         min(e.registration_date) AS primer_curso,
         count(*)                 AS n_cursos,
         sum(e.total_amount)      AS pagado,
         string_agg(pr.program_name || ' #' || e.enrollment_id ||
                    ' (S/.' || e.total_amount || ')', ' | '
                    ORDER BY e.registration_date) AS cursos
    FROM memb m
    JOIN customers c         ON c.customer_id = m.customer_id
    JOIN persons pe          ON pe.person_id  = c.person_id
    JOIN enrollments e       ON e.customer_id = m.customer_id
    JOIN program_versions pv USING (program_version_id)
    JOIN programs pr         USING (program_id)
   WHERE NOT pr.is_membership
     AND pr.cat_model_modality = 2624          -- En Vivo
     AND e.active = 'Y'
     AND e.parent_enrollment_id IS NULL        -- fuera hijos de paquete
     AND e.total_amount > 0                    -- compra real, no beneficio de membresia
     AND e.registration_date > m.fecha_memb    -- primero la membresia
   GROUP BY 1,2,3,4,5
   ORDER BY m.fecha_memb`, [desde, hasta])

console.log(`\nMembresia -> compro cursos EN VIVO aparte  (${desde} a ${hasta}):  ${rows.length} alumnos\n`)
const fx = d => d.toISOString().slice(0, 16).replace('T', ' ')
console.table(rows.map(r => ({
  cliente: r.customer_id,
  alumno: (r.alumno || '').slice(0, 30),
  doc: r.doc,
  memb: r.membresia,
  f_memb: fx(r.fecha_memb),
  f_curso: fx(r.primer_curso),
  n: Number(r.n_cursos),
  pagado: r.pagado
})))
console.log('\nTotal facturado post-membresia: S/.',
  rows.reduce((s, r) => s + Number(r.pagado), 0).toFixed(2))
for (const r of rows) console.log(`\n#${r.customer_id} ${r.alumno} (${r.membresia})\n   ${r.cursos}`)
await pool.end()
