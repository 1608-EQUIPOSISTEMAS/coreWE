// One-off (2026-08-28): POMIER SIERRA XIOMARA, enrollment 9940 (DIP PROC Y MEJORA V4).
//
// La venta se importo el 25/06 con ED "E0" (convalidacion), asi que el padre quedo
// con program_edition_id NULL y el importador masivo NO crea hijos: la alumna no
// figuraba en ninguna aula. Su fila cayo en pleno bloque E1 de la hoja (9933, 9941,
// 9947, 9948, 9954, 9955 son todos E1) y sus pagos son de enero/marzo 2026, que
// calzan con la cohorte E1 (26/02/2026 - 17/10/2026). El usuario confirmo E1.
//
// Las 5 ediciones de modulo NO se hardcodean: se leen de los hijos que el propio
// ERP ya creo para un padre E1 vivo (PADRE_E1_REFERENCIA). Si esa cohorte se
// reconfigura, el script sigue diciendo la verdad.
//
// Se registran como edition_override (NO convalidacion: la alumna cursa los 5) y
// se corre createChildEnrollments, el mismo camino que usa FICO. Los hijos salen
// SEG en 0.00 por diseno: el cobro real de S/1360 sigue viviendo entero en el
// padre y no se duplica el ingreso.
//
// Odoo y correo quedan anulados a proposito: es una correccion de datos de junio
// y los modulos ya arrancaron (feb-sep); un correo de confirmacion ahora confunde.
// El padre NO se toca: su edicion NULL es el marcador E0, no un error.
//
//   node scripts/fix-9940-hijos-seg.mjs            # DRY-RUN contra PRODUCCION
//   node scripts/fix-9940-hijos-seg.mjs --aplicar  # aplica en PRODUCCION
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Apuntar el pool de la app (src/config/db.js lo lee al importarse) a produccion
// ANTES de cargar cualquier modulo del backend. PGPASSWORD no: partiria el pool
// de los scripts y el de la app en dos BD distintas sin avisar.
const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const respaldo = fs.readFileSync(path.join(raiz, '.env.bak-produccion'), 'utf8')
process.env.DATABASE_URL = respaldo.match(/^DATABASE_URL=(.+)$/m)[1].trim()
process.env.DATABASE_URL_DIRECT = process.env.DATABASE_URL

await import('../src/modules/fico/fico.bootstrap.js') // cablea logAudit (sin el, sin bitacora)
const { pool, query: q } = await import('../src/shared/db/pool.js')
const { createChildEnrollments, setPorts } = await import('../src/modules/fico/validation/validation.usecases.js')

const PADRE = 9940
const PADRE_E1_REFERENCIA = 9941 // mismo diplomado, cohorte E1, hijos ya creados por el ERP
const USER_ID = 9 // ADMIN
const NOTA = 'Correccion 28/08/2026: import masivo con ED E0 dejo al padre sin hijos SEG; cohorte E1 confirmada'

const aplicar = process.argv.includes('--aplicar')

setPorts({ enrollInOdoo: async () => null, sendConfirmationEmail: async () => null })

const hijos = () => q(
  `SELECT e.enrollment_id, e.program_version_id, pv.abbreviation AS modulo,
          e.program_edition_id, pe.global_code, e.total_amount, c.description AS estado
     FROM enrollments e
     LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
     LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
     LEFT JOIN catalog c ON c.catalog_id = e.cat_type_status
    WHERE e.parent_enrollment_id = $1 ORDER BY e.enrollment_id`, [PADRE]
).then(r => r.rows)

const { rows: [padre] } = await q(
  `SELECT enrollment_id, customer_id, program_version_id, program_edition_id, total_amount, notes
     FROM enrollments WHERE enrollment_id = $1`, [PADRE])
if (!padre) { console.error(`No existe el enrollment ${PADRE}`); process.exit(1) }

const previos = await hijos()
const { rows: validaciones } = await q('SELECT * FROM enrollment_validations WHERE enrollment_id = $1', [PADRE])

console.log('--- padre ---'); console.table([padre])
console.log('--- hijos actuales ---'); console.table(previos)

if (previos.length > 0 || validaciones.length > 0) {
  console.log('\nYa tiene hijos o convalidaciones: nada que hacer (idempotente).')
  await pool.end(); process.exit(0)
}

// Ediciones de modulo de la cohorte E1, tal como el ERP ya las asigno a un alumno vivo.
const { rows: modulos } = await q(
  `SELECT h.program_version_id AS pv, pv.abbreviation AS modulo,
          h.program_edition_id AS edicion, pe.global_code, pe.start_date::date AS inicio
     FROM enrollments h
     JOIN program_versions pv ON pv.program_version_id = h.program_version_id
     JOIN program_editions pe ON pe.edition_num_id = h.program_edition_id
    WHERE h.parent_enrollment_id = $1 ORDER BY pe.start_date`, [PADRE_E1_REFERENCIA])

const { rows: estructura } = await q(
  `SELECT child_program_version_id FROM program_version_structure
    WHERE parent_program_version_id = $1`, [padre.program_version_id])

if (modulos.length !== estructura.length) {
  console.error(`El padre de referencia ${PADRE_E1_REFERENCIA} tiene ${modulos.length} hijos y el paquete ${estructura.length} modulos. Revisar a mano.`)
  await pool.end(); process.exit(1)
}

console.log('--- ediciones E1 a aplicar ---'); console.table(modulos)

if (!aplicar) {
  console.log('\nDRY-RUN. Se crearian esos 5 hijos SEG en 0.00. Correr con --aplicar.')
  await pool.end(); process.exit(0)
}

fs.writeFileSync(
  new URL(`./_backup_${PADRE}_2026-08-28.json`, import.meta.url),
  JSON.stringify({ padre, hijos: previos, validaciones, modulos }, null, 2))

for (const m of modulos) {
  await q(
    `INSERT INTO enrollment_validations
       (enrollment_id, child_version_id, validation_type, custom_edition_id, notes, status, requested_by)
     VALUES ($1, $2, 'edition_override', $3, $4, 'pending', $5)`,
    [PADRE, m.pv, m.edicion, NOTA, USER_ID])
}

const res = await createChildEnrollments({ enrollmentId: PADRE, userId: USER_ID })
console.log('\ncreateChildEnrollments ->', res)
console.log('--- hijos resultantes ---'); console.table(await hijos())

await pool.end()
process.exit(0)
