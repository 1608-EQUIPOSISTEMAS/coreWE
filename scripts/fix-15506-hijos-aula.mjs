// One-off (2026-08-25): HUAMANI RAMOS SHIRLEY CRISTEL (fila 268 de PC-EZ-02).
//
// La venta se importo el 03/08 como padre E0 (ED "E0" = convalidacion, edicion
// NULL) y el importador masivo NO crea hijos, asi que la alumna no figura en
// ninguna aula. La hoja si dice en que cohorte va cada modulo:
//
//   POWER APPS Y AUT.  FI 06/06/2026 -> E26 (edicion 15019)
//   POWER APPS AVANZ   FI 18/07/2026 -> E20 (edicion 15079)
//
// Se registran esas dos ediciones como edition_override (NO convalidacion: la
// alumna cursa ambos modulos) y se corre createChildEnrollments, el mismo camino
// que usa FICO. Los hijos salen SEG en 0.00 por diseno, con lo que el cobro real
// de S/275 sigue viviendo entero en el padre y no se duplica el ingreso.
//
// Odoo y correo quedan anulados a proposito: es una correccion de datos viejos,
// no un alta nueva, y el CC de origen todavia no esta identificado.
// El padre NO se toca: su edicion NULL es el marcador E0, no un error.
//
//   node scripts/fix-15506-hijos-aula.mjs            # DRY-RUN, no escribe
//   node scripts/fix-15506-hijos-aula.mjs --aplicar  # aplica
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import '../src/modules/fico/fico.bootstrap.js' // cablea logAudit (sin el, sin bitacora)
import { q, pool } from './db.mjs'
import { createChildEnrollments, setPorts } from '../src/modules/fico/validation/validation.usecases.js'

const PADRE = 15506
const USER_ID = 9 // ADMIN
const MODULOS = [
  { pv: 60, edicion: 15019, curso: 'POWER APPS Y AUT.' },
  { pv: 61, edicion: 15079, curso: 'POWER APPS AVANZ' }
]
const NOTA = 'Reasignacion 1er modulo (viene de un CC sin identificar) - hoja FICO PC-EZ-02 fila 268'

const aplicar = process.argv.includes('--aplicar')

setPorts({ enrollInOdoo: async () => null, sendConfirmationEmail: async () => null })

const hijos = () => q(
  `SELECT e.enrollment_id, e.program_version_id, e.program_edition_id, e.total_amount,
          c.description AS estado, pe.global_code
     FROM enrollments e
     LEFT JOIN catalog c ON c.catalog_id = e.cat_type_status
     LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    WHERE e.parent_enrollment_id = $1 ORDER BY e.enrollment_id`, [PADRE]
).then(r => r.rows)

const { rows: [padre] } = await q(
  `SELECT enrollment_id, program_version_id, program_edition_id, total_amount, notes
     FROM enrollments WHERE enrollment_id = $1`, [PADRE]
)
if (!padre) { console.error(`No existe el enrollment ${PADRE}`); process.exit(1) }

const previos = await hijos()
const { rows: validaciones } = await q('SELECT * FROM enrollment_validations WHERE enrollment_id = $1', [PADRE])

console.log('--- padre ---'); console.table([padre])
console.log('--- hijos actuales ---'); console.table(previos)
console.log('--- validaciones actuales ---'); console.table(validaciones)

if (previos.length > 0) {
  console.log('\nYa tiene hijos: nada que hacer (idempotente).')
  await pool.end(); process.exit(0)
}

if (!aplicar) {
  console.log('\nDRY-RUN. Se crearian estos hijos SEG en 0.00:')
  console.table(MODULOS)
  await pool.end(); process.exit(0)
}

writeFileSync(
  new URL(`./_backup_${PADRE}_2026-08-25.json`, import.meta.url),
  JSON.stringify({ padre, hijos: previos, validaciones }, null, 2)
)

for (const m of MODULOS) {
  await q(
    `INSERT INTO enrollment_validations
       (enrollment_id, child_version_id, validation_type, custom_edition_id, notes, status, requested_by)
     VALUES ($1, $2, 'edition_override', $3, $4, 'pending', $5)`,
    [PADRE, m.pv, m.edicion, NOTA, USER_ID]
  )
}

const res = await createChildEnrollments({ enrollmentId: PADRE, userId: USER_ID })
console.log('\ncreateChildEnrollments ->', res)
console.log('--- hijos resultantes ---'); console.table(await hijos())

await pool.end()

process.exit(0)
