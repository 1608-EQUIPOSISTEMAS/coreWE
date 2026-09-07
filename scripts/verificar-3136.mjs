// Verificacion de la reubicacion de 3136: corre el MISMO caso de uso que la
// pantalla /academica/aulas/15878 y confirma que el alumno ya sale en la lista.
import 'dotenv/config'
import { pool } from '../src/config/db.js'
import { editionRepository } from '../src/modules/edition/edition.repository.js'

const alumnos = await editionRepository.classroomStudentsList(15878)
const yo = alumnos.find(a => a.enrollment_id === 3136)
console.log(`Aula 15878: ${alumnos.length} alumnos en la lista activa`)
console.log(yo ? `OK  3136 ${yo.full_name} — ${yo.type_status_label}` : 'FALTA: 3136 sigue sin aparecer')

const { rows: quedan } = await pool.query(`
  SELECT e.enrollment_id, ts.description AS estado,
         TRIM(concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS alumno
    FROM enrollments e
    JOIN customers c ON c.customer_id = e.customer_id
    JOIN persons per ON per.person_id = c.person_id
    JOIN catalog cf ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
    LEFT JOIN catalog ts ON ts.catalog_id = e.cat_type_status
   WHERE e.program_edition_id = 15673 AND e.active = 'Y'
   ORDER BY e.enrollment_id`)
console.log(`\nSiguen varados en la edicion A5 15673: ${quedan.length}`)
console.table(quedan)

await pool.end()
process.exit(0)
