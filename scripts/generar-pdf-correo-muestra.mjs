// ponytail: genera el PDF que se adjunta al correo de inscripcion, para revisarlo
// sin mandar correos. Toma un enrollment con edicion y otro en E0.
import fs from 'fs'
import { pool } from '../src/config/db.js'
import { generateCronogramaPdf } from '../src/services/pdf.service.js'

const outDir = process.argv[2] || '.'

const { rows } = await pool.query(`
  SELECT e.enrollment_id, e.program_edition_id, pv.abbreviation
  FROM enrollments e
  JOIN program_versions pv ON pv.program_version_id = e.program_version_id
  JOIN edition_structure es ON es.parent_edition_id = e.program_edition_id
  WHERE e.parent_enrollment_id IS NULL
  GROUP BY e.enrollment_id, e.program_edition_id, pv.abbreviation
  HAVING count(*) >= 3
  ORDER BY e.enrollment_id DESC
  LIMIT 2
`)

const { rows: e0 } = await pool.query(`
  SELECT e.enrollment_id, pv.abbreviation
  FROM enrollments e
  JOIN program_versions pv ON pv.program_version_id = e.program_version_id
  JOIN program_version_structure pvs ON pvs.parent_program_version_id = e.program_version_id
  WHERE e.parent_enrollment_id IS NULL AND e.program_edition_id IS NULL
  GROUP BY e.enrollment_id, pv.abbreviation
  ORDER BY e.enrollment_id DESC LIMIT 1
`)

for (const r of [...rows, ...e0]) {
  const buf = await generateCronogramaPdf({ enrollmentId: r.enrollment_id })
  const file = `${outDir}/correo-${r.enrollment_id}.pdf`
  fs.writeFileSync(file, buf)
  console.log(`#${r.enrollment_id} ${r.abbreviation} -> ${file} (${buf.length} bytes)`)
}
await pool.end()
