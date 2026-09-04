// Crea los hijos SEG que el import con ED "E0" nunca creo (padre de paquete sin
// aulas: el alumno no figura en ninguna). Registra el plan modulo por modulo en
// enrollment_validations y llama createChildEnrollments, sin Odoo ni correo.
//
//   node scripts/fix-hijos-seg-e0.mjs <enrollment_id> <pv:edicion|pv:conv> ... [--apply]
//   node scripts/fix-hijos-seg-e0.mjs 18516 175:15574 18:15014 19:14862 20:14948 --apply
//
// `pv:conv` = modulo convalidado (fila same_edition, sin hijo). El padre NO se
// toca: su program_edition_id NULL es el marcador de E0, no un error.
import { writeFileSync } from 'node:fs'

const USER_ID = 9 // ADMIN: la correccion no la hizo el asesor

const args = process.argv.slice(2)
const aplicar = args.includes('--apply')
const posicionales = args.filter(a => !a.startsWith('--'))
const PADRE = Number(posicionales[0])
const PLAN = posicionales.slice(1).map(par => {
  const [pv, ed] = par.split(':')
  return { pv: Number(pv), edicion: /^\d+$/.test(ed || '') ? Number(ed) : null }
})

if (!PADRE || PLAN.length === 0 || PLAN.some(p => !p.pv)) {
  console.error('Uso: node scripts/fix-hijos-seg-e0.mjs <enrollment_id> <pv:edicion|pv:conv> ... [--apply]')
  process.exit(1)
}

await import('../src/modules/fico/fico.bootstrap.js') // sin esto logAudit es no-op
const { pool, query: q } = await import('../src/shared/db/pool.js')
const { createChildEnrollments, setPorts } = await import('../src/modules/fico/validation/validation.usecases.js')

// Correccion de datos historica, no un alta: nada de inscribir en Odoo ni de
// mandar el correo de bienvenida de un curso que ya termino.
setPorts({ enrollInOdoo: async () => null, sendConfirmationEmail: async () => null })

const salir = async (codigo) => { await pool.end(); process.exit(codigo) }

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
if (!padre) { console.error(`No existe el enrollment ${PADRE}`); await salir(1) }

const previos = await hijos()
const { rows: validaciones } = await q('SELECT * FROM enrollment_validations WHERE enrollment_id = $1', [PADRE])
console.log('--- padre ---'); console.table([padre])
console.log('--- hijos actuales ---'); console.table(previos)

if (previos.length > 0 || validaciones.length > 0) {
  console.log('\nYa tiene hijos o convalidaciones: nada que hacer (idempotente).')
  await salir(0)
}

// El plan tiene que cubrir el paquete entero: si el ERP reconfigura los modulos
// del programa, el plan deja de decir la verdad y hay que revisarlo a mano.
const { rows: estructura } = await q(
  'SELECT child_program_version_id AS pv FROM program_version_structure WHERE parent_program_version_id = $1',
  [padre.program_version_id])
const faltan = estructura.filter(e => !PLAN.some(p => p.pv === e.pv))
if (faltan.length || estructura.length !== PLAN.length) {
  console.error(`El paquete tiene ${estructura.length} modulos y el plan cubre ${PLAN.length}. Sin cubrir:`, faltan)
  await salir(1)
}

// Las ediciones del plan tienen que existir y ser del modulo que dice el plan.
const conEdicion = PLAN.filter(p => p.edicion)
const { rows: edics } = await q(
  `SELECT edition_num_id, program_version_id, global_code, start_date::date AS ini
     FROM program_editions WHERE edition_num_id = ANY($1::int[])`, [conEdicion.map(p => p.edicion)])
console.log('--- ediciones del plan ---'); console.table(edics)
for (const p of conEdicion) {
  const ed = edics.find(e => e.edition_num_id === p.edicion)
  if (!ed || ed.program_version_id !== p.pv) {
    console.error(`La edicion ${p.edicion} no existe o no es del modulo pv ${p.pv}.`)
    await salir(1)
  }
}

if (!aplicar) {
  console.log(`\nDRY-RUN. Se crearian ${conEdicion.length} hijos SEG en 0.00 y ${PLAN.length - conEdicion.length} convalidacion(es). Correr con --apply.`)
  await salir(0)
}

writeFileSync(new URL(`./_backup_hijos_seg_${PADRE}.json`, import.meta.url),
  JSON.stringify({ padre, hijos: previos, validaciones, PLAN }, null, 2))

const NOTA = `Correccion: import con ED E0 dejo al padre ${PADRE} sin hijos SEG; plan de ediciones tomado de la fila FICO`
for (const p of PLAN) {
  await q(
    `INSERT INTO enrollment_validations
       (enrollment_id, child_version_id, validation_type, custom_edition_id, notes, status, requested_by)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
    [PADRE, p.pv, p.edicion ? 'edition_override' : 'same_edition', p.edicion, NOTA, USER_ID])
}

console.log('\ncreateChildEnrollments ->', await createChildEnrollments({ enrollmentId: PADRE, userId: USER_ID }))
console.log('--- hijos resultantes ---'); console.table(await hijos())
await salir(0)
