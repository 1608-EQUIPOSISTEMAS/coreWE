// One-off (2026-09-03): CONISLLA ABURTO ANA CECILIA, enrollment 18197 (ESPEC.SAP HANA).
//
// Importada el 31/08/2026 con ED "E0": el importador la trata como convalidacion,
// deja program_edition_id NULL y NO crea hijos, asi que la alumna no figura en
// ninguna aula. Mismo caso que 9940; ver scripts/fix-9940-hijos-seg.mjs.
//
// Aqui la cohorte NO se deduce: la fila FICO da la edicion modulo por modulo, y
// el par de columnas de SAP HANA MM viene vacio = modulo convalidado (CONV / MOD
// FLEX en la misma fila). Por eso el plan es literal, no una copia de otro padre:
//
//   SAP HANA MM (pv 1)  -> convalidado            (same_edition, sin hijo)
//   SAP HANA PP (pv 4)  -> 04/01/2026 = ed 14739  (E17 / E1-26)
//   SAP HANA FI (pv 6)  -> 28/12/2025 = ed 14733  (E58 / E12-25)
//
// El padre NO se toca: su edicion NULL es el marcador E0, no un error.
// Odoo y correo anulados: es correccion de datos de una venta de nov-2025 cuyos
// modulos ya terminaron; mandar el correo de bienvenida ahora seria un error.
//
//   node scripts/fix-18197-hijos-seg.mjs            # DRY-RUN (PRODUCCION)
//   node scripts/fix-18197-hijos-seg.mjs --aplicar  # aplica
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const respaldo = fs.readFileSync(path.join(raiz, '.env.bak-produccion'), 'utf8')
process.env.DATABASE_URL = respaldo.match(/^DATABASE_URL=(.+)$/m)[1].trim()
process.env.DATABASE_URL_DIRECT = process.env.DATABASE_URL

await import('../src/modules/fico/fico.bootstrap.js') // sin esto logAudit es no-op
const { pool, query: q } = await import('../src/shared/db/pool.js')
const { createChildEnrollments, setPorts } = await import('../src/modules/fico/validation/validation.usecases.js')

const PADRE = 18197
const USER_ID = 9 // ADMIN
const NOTA = 'Correccion 03/09/2026: import masivo con ED E0 dejo al padre sin hijos SEG (hoja FICO: MM convalidado, PP 04/01/2026, FI 28/12/2025)'
const aplicar = process.argv.includes('--aplicar')

// Plan literal de la fila FICO. custom_edition_id null = modulo convalidado.
const PLAN = [
  { pv: 1, modulo: 'SAP HANA MM', tipo: 'same_edition', edicion: null },
  { pv: 4, modulo: 'SAP HANA PP', tipo: 'edition_override', edicion: 14739 },
  { pv: 6, modulo: 'SAP HANA FI', tipo: 'edition_override', edicion: 14733 }
]

setPorts({ enrollInOdoo: async () => null, sendConfirmationEmail: async () => null })

const hijos = () => q(
  `SELECT e.enrollment_id, pv.abbreviation AS modulo, pe.global_code AS ed,
          pe.start_date::date AS ini, c.description AS estado, e.total_amount
     FROM enrollments e
     LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
     LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
     LEFT JOIN catalog c ON c.catalog_id = e.cat_type_status
    WHERE e.parent_enrollment_id = $1 ORDER BY e.enrollment_id`, [PADRE]
).then(r => r.rows)

const { rows: [padre] } = await q(
  'SELECT enrollment_id, program_version_id, program_edition_id, total_amount, notes FROM enrollments WHERE enrollment_id = $1',
  [PADRE])
if (!padre) { console.error(`No existe el enrollment ${PADRE}`); process.exit(1) }

const previos = await hijos()
const { rows: validaciones } = await q('SELECT * FROM enrollment_validations WHERE enrollment_id = $1', [PADRE])
console.log('--- padre ---'); console.table([padre])
console.log('--- hijos actuales ---'); console.table(previos)

if (previos.length > 0 || validaciones.length > 0) {
  console.log('\nYa tiene hijos o convalidaciones: nada que hacer (idempotente).')
  await pool.end(); process.exit(0)
}

// El plan tiene que cubrir el paquete entero: si el ERP reconfigura los modulos
// del programa, este script deja de decir la verdad y hay que revisarlo a mano.
const { rows: estructura } = await q(
  'SELECT child_program_version_id AS pv FROM program_version_structure WHERE parent_program_version_id = $1',
  [padre.program_version_id])
const faltan = estructura.filter(e => !PLAN.some(p => p.pv === e.pv))
if (faltan.length || estructura.length !== PLAN.length) {
  console.error(`El paquete tiene ${estructura.length} modulos y el PLAN cubre ${PLAN.length}. Sin cubrir:`, faltan)
  await pool.end(); process.exit(1)
}

// Las ediciones del plan tienen que existir y ser del modulo que dice el plan.
const { rows: edics } = await q(
  `SELECT edition_num_id, program_version_id, global_code, start_date::date AS ini
     FROM program_editions WHERE edition_num_id = ANY($1::int[])`,
  [PLAN.filter(p => p.edicion).map(p => p.edicion)])
console.log('--- ediciones del plan ---'); console.table(edics)
for (const p of PLAN.filter(p => p.edicion)) {
  const ed = edics.find(e => e.edition_num_id === p.edicion)
  if (!ed || ed.program_version_id !== p.pv) {
    console.error(`La edicion ${p.edicion} no existe o no es de ${p.modulo} (pv ${p.pv}).`)
    await pool.end(); process.exit(1)
  }
}

if (!aplicar) {
  console.log(`\nDRY-RUN. Se crearian ${PLAN.filter(p => p.edicion).length} hijos SEG en 0.00 y 1 convalidacion. Correr con --aplicar.`)
  await pool.end(); process.exit(0)
}

fs.writeFileSync(
  new URL(`./_backup_${PADRE}_2026-09-03.json`, import.meta.url),
  JSON.stringify({ padre, hijos: previos, validaciones, PLAN }, null, 2))

for (const p of PLAN) {
  await q(
    `INSERT INTO enrollment_validations
       (enrollment_id, child_version_id, validation_type, custom_edition_id, notes, status, requested_by)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
    [PADRE, p.pv, p.tipo, p.edicion, NOTA, USER_ID])
}

const res = await createChildEnrollments({ enrollmentId: PADRE, userId: USER_ID })
console.log('\ncreateChildEnrollments ->', res)
console.log('--- hijos resultantes ---'); console.table(await hijos())

await pool.end()
process.exit(0)
