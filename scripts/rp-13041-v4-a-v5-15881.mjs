// Reubicacion interna de la venta 13041 (CAHUANA CHUMPITAZ DANIELA RUBI) desde
// PEE ANALIST PROY V4 E37 (edicion 15678, cancelada A5 + active='N') hacia
// PEE ANALIST PROY V5 E37 (edicion 15881, misma fecha 26/08 -> 20/01).
//
// POR QUE NO ES EL RP DE FICO: el destino es otra version del programa
// (program_version 74 -> 236), y reprogramEdition exige la misma version
// (enrollment.usecases.js:229). El motor canonico seria courseChange, pero ese
// crea una venta NUEVA colgada del origen y le mete un pago de S/565 con fecha de
// hoy: dinero duplicado en los reportes por una edicion que cancelamos nosotros.
// El usuario pidio (31/08/2026) moverla "internamente": una sola venta, el pago
// intacto, sin Odoo y sin correo. El aula vieja de Odoo se coordina a mano.
//
// Los hijos SI se rehacen con el caso de uso real (createChildEnrollments), que
// es quien sabe leer el arbol de la edicion destino y crearlos en SEG.
//
// Uso:
//   DATABASE_URL=<tunel prod> node scripts/rp-13041-v4-a-v5-15881.mjs           # DRY-RUN
//   DATABASE_URL=<tunel prod> node scripts/rp-13041-v4-a-v5-15881.mjs --aplicar
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
// Sin el bootstrap, logAudit es un no-op silencioso y la reubicacion corre sin
// bitacora (enrollment.repository.js:26).
import '../src/modules/fico/fico.bootstrap.js'
import { pool } from '../src/config/db.js'
import { enrollmentRepository as repo, ALIAS } from '../src/modules/fico/enrollment/enrollment.repository.js'
import { validationRepository } from '../src/modules/fico/validation/validation.repository.js'
import { createChildEnrollments } from '../src/modules/fico/validation/validation.usecases.js'

const VENTA = 13041
const ED_ORIGEN = 15678
const ED_DESTINO = 15881
const PV_DESTINO = 236
const USER_ID = 9 // ADMIN
const JUSTIFICACION =
  'Reubicacion por cancelacion de PEE ANALIST PROY V4 E37 (edicion 15678, A5). ' +
  'Producto rehizo la edicion como PEE ANALIST PROY V5 E37 (edicion 15881), misma ' +
  'fecha 26/08/2026-20/01/2027. Correccion interna: sin Odoo y sin correo al alumno.'

const aplicar = process.argv.includes('--aplicar')
const q = (text, params) => pool.query(text, params)

// -- 1. Respaldo antes de tocar nada --------------------------------------
const familia = await q(`
  SELECT * FROM enrollments
   WHERE enrollment_id = $1 OR parent_enrollment_id = $1
   ORDER BY enrollment_id`, [VENTA])
const ids = familia.rows.map(r => r.enrollment_id)
const respaldo = {
  enrollments: familia.rows,
  cuotas: (await q('SELECT * FROM payment_installments WHERE enrollment_id = ANY($1::int[])', [ids])).rows,
  pagos: (await q('SELECT * FROM payments WHERE enrollment_id = ANY($1::int[])', [ids])).rows
}
writeFileSync(new URL('./_backup_13041_v4_a_v5.json', import.meta.url), JSON.stringify(respaldo, null, 2))
console.log(`Respaldo: ${respaldo.enrollments.length} enrollments, ${respaldo.cuotas.length} cuotas, ${respaldo.pagos.length} pagos`)

// -- 2. Guardas: el estado de partida tiene que ser el esperado ------------
const venta = familia.rows.find(r => r.enrollment_id === VENTA)
if (!venta) throw new Error(`La venta ${VENTA} no existe`)
if (venta.program_edition_id !== ED_ORIGEN) throw new Error(`La venta ya no esta en la edicion ${ED_ORIGEN} (esta en ${venta.program_edition_id})`)

// Una convalidacion cambiaria que modulos se crean: si aparece, decide un humano.
const validaciones = await validationRepository.getValidations(VENTA)
if (validaciones.length > 0) throw new Error(`La venta tiene ${validaciones.length} convalidacion(es): revisar a mano`)

// El arbol del destino tiene que cubrir TODOS los modulos de la estructura V5. Si
// no, buildEditionPlan marca el escenario E0 y createChildEnrollments le borra la
// edicion al padre (clearParentEdition), justo lo contrario de lo que buscamos.
const estructura = await validationRepository.findChildrenStructure(PV_DESTINO)
const arbol = await validationRepository.getEditionTreeChildren(ED_DESTINO)
const conEdicion = new Set(arbol.map(a => a.child_program_version_id))
const sinEdicion = estructura.filter(s => !conEdicion.has(s.child_program_version_id))
if (sinEdicion.length > 0) throw new Error(`Modulos del destino sin edicion en el arbol (seria E0): ${sinEdicion.map(s => s.child_name).join(', ')}`)
console.log(`Destino ${ED_DESTINO}: ${estructura.length} modulo(s), todos con edicion en el arbol`)

if (!aplicar) {
  console.log('\nDRY-RUN: no se escribio nada. Corre con --aplicar para ejecutar.')
  await pool.end()
  process.exit(0)
}

// -- 3. Hijos del arbol V4 -> R (retirados) -------------------------------
const retId = await repo.resolveCatalogId(ALIAS.ENROLLMENT_STATUS_RETIRED)
if (!retId) throw new Error('No se resolvio el catalogo Retirado')
for (const hijo of await repo.getActiveChildren(VENTA, retId)) {
  await repo.retireChild(hijo.enrollment_id, retId)
  await repo.logAudit({
    enrollmentId: hijo.enrollment_id,
    action: 'retired',
    userId: USER_ID,
    justificacion: JUSTIFICACION,
    details: `Retirado al reubicar el paquete padre #${VENTA} de PEE ANALIST PROY V4 E37 (ed. ${ED_ORIGEN}) a V5 E37 (ed. ${ED_DESTINO}): este modulo pertenece al arbol de la version V4`
  })
  console.log(`  hijo #${hijo.enrollment_id} ${hijo.child_program_name} ${hijo.edition_code} -> R`)
}

// -- 4. La venta se muda de edicion y de version --------------------------
await q('UPDATE enrollments SET program_edition_id = $1, program_version_id = $2, modification_date = NOW(), user_modification_id = $3 WHERE enrollment_id = $4',
  [ED_DESTINO, PV_DESTINO, USER_ID, VENTA])
console.log(`venta #${VENTA}: edicion ${ED_ORIGEN} -> ${ED_DESTINO}, version ${venta.program_version_id} -> ${PV_DESTINO}`)

// -- 5. Hijos SEG del arbol V5 --------------------------------------------
const { isE0, createdChildren } = await createChildEnrollments({ enrollmentId: VENTA, userId: USER_ID })
if (isE0) throw new Error('createChildEnrollments marco E0: revisar, la edicion del padre pudo quedar en null')
console.log(`hijos SEG creados: ${createdChildren.map(c => `#${c.id} ${c.code}`).join(', ')}`)

// -- 6. Bitacora del padre ------------------------------------------------
// action 'edition_reprogrammed' + el ancla old_edition_id no son decorativos: es
// como el historial del aula vieja la sigue mostrando aunque su fila ya no
// apunte ahi (edition.repository.js, classroomStudentsHistory).
await repo.logAudit({
  enrollmentId: VENTA,
  action: 'edition_reprogrammed',
  userId: USER_ID,
  justificacion: JUSTIFICACION,
  changes: {
    Version: { old: 'PEE ANALIST PROY V4 (PY-PZ-04, 18 ses)', new: 'PEE ANALIST PROY V5 (PY-PZ-05, 19 ses)' },
    Edicion: { old: `E37 (ed. ${ED_ORIGEN}, 26/08/2026, cancelada A5)`, new: `E37 (ed. ${ED_DESTINO}, 26/08/2026)` },
    Modulos: { old: 'GEST PROYECT I E40, GEST. AGIL PROYECT E26, MS PROJECT E64', new: 'GEST PROYECT E1, GEST. AGIL PROYECT V2 E1, MS PROJECT E64' },
    old_edition_id: ED_ORIGEN,
    new_edition_id: ED_DESTINO
  },
  details: `Reubicacion interna V4 -> V5: la venta venia de PEE ANALIST PROY V4 E37 (ed. ${ED_ORIGEN}), cancelada A5 y nunca migrada. Se mantiene la misma inscripcion, el mismo pago (S/565 al contado) y se rehacen los modulos SEG con el arbol de la edicion ${ED_DESTINO}. Sin Odoo y sin correo por pedido de FICO.`
})

repo.refreshMv('reubicacion-13041')

// -- 7. Verificacion ------------------------------------------------------
const { rows: final } = await q(`
  SELECT e.enrollment_id, e.parent_enrollment_id, e.program_edition_id, e.program_version_id,
         pe.specific_code AS edicion, pv.abbreviation, ts.description AS estado, e.total_amount
    FROM enrollments e
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN catalog ts ON ts.catalog_id = e.cat_type_status
   WHERE e.enrollment_id = $1 OR e.parent_enrollment_id = $1
   ORDER BY e.enrollment_id`, [VENTA])
console.table(final)

await pool.end()
process.exit(0)
