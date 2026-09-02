// One-off (2026-09-01): CONISLLA ABURTO ANA CECILIA, enrollment 18197 (ESPEC.SAP HANA).
//
// Importada el 31/08/2026 con ED "E0": el importador la trata como convalidacion,
// deja program_edition_id NULL y NO crea hijos, asi que la alumna no figura en
// ninguna aula. Mismo caso que 9940; ver scripts/fix-9940-hijos-seg.mjs.
//
// La cohorte NO se adivina: se pasa por argumento (--cohorte <edition_num_id> del
// PADRE) y las ediciones de cada modulo se copian de un padre vivo de esa misma
// cohorte, tal como el ERP ya se las asigno. Si la cohorte se reconfigura, el
// script sigue diciendo la verdad.
//
// El padre NO se toca: su edicion NULL es el marcador E0, no un error.
// Odoo y correo anulados: es correccion de datos de una venta de nov-2025.
//
//   node scripts/fix-18197-hijos-seg.mjs --cohorte 15344            # DRY-RUN (PRODUCCION)
//   node scripts/fix-18197-hijos-seg.mjs --cohorte 15344 --aplicar  # aplica
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
const cohorte = Number(process.argv[process.argv.indexOf('--cohorte') + 1])
const aplicar = process.argv.includes('--aplicar')
if (!Number.isInteger(cohorte)) { console.error('Falta --cohorte <edition_num_id del padre>'); process.exit(1) }

const NOTA = `Correccion 01/09/2026: import masivo con ED E0 dejo al padre sin hijos SEG; cohorte edicion ${cohorte}`

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

// Ediciones de modulo de la cohorte elegida, leidas de los hijos que el ERP ya
// creo para los padres vivos de esa edicion. DISTINCT ON: si dos padres tienen
// hijos en ediciones distintas del mismo modulo, gana el mas usado.
const { rows: modulos } = await q(
  `SELECT DISTINCT ON (h.program_version_id)
          h.program_version_id AS pv, pv.abbreviation AS modulo,
          h.program_edition_id AS edicion, pe.global_code, pe.start_date::date AS inicio,
          count(*) OVER (PARTITION BY h.program_version_id, h.program_edition_id) AS usos
     FROM enrollments p
     JOIN enrollments h ON h.parent_enrollment_id = p.enrollment_id AND h.active = 'Y'
     JOIN program_versions pv ON pv.program_version_id = h.program_version_id
     JOIN program_editions pe ON pe.edition_num_id = h.program_edition_id
    WHERE p.program_edition_id = $1 AND p.active = 'Y'
    ORDER BY h.program_version_id, usos DESC, pe.start_date`, [cohorte])

const { rows: estructura } = await q(
  'SELECT child_program_version_id FROM program_version_structure WHERE parent_program_version_id = $1',
  [padre.program_version_id])

console.log(`--- ediciones de la cohorte ${cohorte} a aplicar ---`); console.table(modulos)

if (modulos.length !== estructura.length) {
  console.error(`La cohorte ${cohorte} aporta ${modulos.length} ediciones y el paquete tiene ${estructura.length} modulos. Revisar a mano.`)
  await pool.end(); process.exit(1)
}

if (!aplicar) {
  console.log(`\nDRY-RUN. Se crearian ${modulos.length} hijos SEG en 0.00. Correr con --aplicar.`)
  await pool.end(); process.exit(0)
}

fs.writeFileSync(
  new URL(`./_backup_${PADRE}_2026-09-01.json`, import.meta.url),
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
