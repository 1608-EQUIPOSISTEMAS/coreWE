// Reubicacion interna de la venta 3136 (ARIAS FEBRES FAUSTO FERNANDO) desde
// GESTION DE PROYECTOS I PY-CZ-06 E6-26 (edicion 15673, cancelada A5 + active='N')
// hacia PY-CZ-07 E1-26 (edicion 15878, misma fecha de inicio 26/08/2026).
//
// POR QUE NO ES EL RP DE FICO: el destino es otra version del mismo programa
// (program_version 71 -> 228, program_id 71 en ambas) y reprogramEdition exige la
// misma version (enrollment.usecases.js:229). El CC tampoco: crearia una venta
// nueva con un pago de hoy, dinero duplicado por una edicion que cancelamos
// nosotros. El usuario pidio (04/09/2026) moverla "por interno": la misma venta,
// el mismo pago, sin Odoo y sin correo.
//
// ponytail: sin manejo de hijos ni de arbol — 3136 es una venta suelta
// (parent_enrollment_id null, 0 hijos, 0 convalidaciones). Si algun dia hay que
// mover un paquete, la receta con arbol es scripts/rp-13041-v4-a-v5-15881.mjs.
//
// Uso:
//   DATABASE_URL=<...> node scripts/reubicar-3136-15673-a-15878.mjs            # DRY-RUN
//   DATABASE_URL=<...> node scripts/reubicar-3136-15673-a-15878.mjs --aplicar
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
// Sin el bootstrap, logAudit es un no-op silencioso y la reubicacion corre sin
// bitacora (enrollment.repository.js:26).
import '../src/modules/fico/fico.bootstrap.js'
import { pool } from '../src/config/db.js'
import { enrollmentRepository as repo } from '../src/modules/fico/enrollment/enrollment.repository.js'

const VENTA = 3136
const ED_ORIGEN = 15673
const ED_DESTINO = 15878
const PV_DESTINO = 228
const USER_ID = 9 // ADMIN
const JUSTIFICACION =
  'Reubicacion por cancelacion de GESTION DE PROYECTOS I PY-CZ-06 E6-26 (edicion ' +
  '15673, A5, nunca migrada). Producto rehizo el curso como PY-CZ-07 E1-26 (edicion ' +
  '15878), mismo inicio 26/08/2026. Correccion interna: sin Odoo y sin correo.'

const aplicar = process.argv.includes('--aplicar')
const q = (text, params) => pool.query(text, params)

// -- 1. Respaldo antes de tocar nada --------------------------------------
const { rows: [venta] } = await q('SELECT * FROM enrollments WHERE enrollment_id = $1', [VENTA])
if (!venta) throw new Error(`La venta ${VENTA} no existe`)
writeFileSync(new URL('./_backup_3136_a5_15673.json', import.meta.url), JSON.stringify({
  enrollment: venta,
  cuotas: (await q('SELECT * FROM payment_installments WHERE enrollment_id = $1', [VENTA])).rows,
  pagos: (await q('SELECT * FROM payments WHERE enrollment_id = $1', [VENTA])).rows
}, null, 2))

// -- 2. Guardas: el estado de partida tiene que ser el esperado ------------
if (venta.program_edition_id !== ED_ORIGEN) throw new Error(`Ya no esta en la edicion ${ED_ORIGEN} (esta en ${venta.program_edition_id})`)
if (venta.parent_enrollment_id !== null) throw new Error('Tiene padre: no es la venta suelta que esperaba esta receta')
const { rows: [{ n }] } = await q('SELECT count(*)::int AS n FROM enrollments WHERE parent_enrollment_id = $1', [VENTA])
if (n > 0) throw new Error(`Tiene ${n} hijo(s): usar la receta con arbol (rp-13041-v4-a-v5-15881.mjs)`)
const { rows: [destino] } = await q(`
  SELECT pe.edition_num_id, pe.active, pe.program_version_id, pv.program_id
    FROM program_editions pe JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
   WHERE pe.edition_num_id = $1`, [ED_DESTINO])
if (!destino || destino.active !== 'Y') throw new Error(`La edicion destino ${ED_DESTINO} no existe o esta inactiva`)
if (destino.program_version_id !== PV_DESTINO) throw new Error(`La edicion ${ED_DESTINO} ya no usa la version ${PV_DESTINO}`)

if (!aplicar) {
  console.log(`DRY-RUN ok: venta ${VENTA} lista para pasar de la edicion ${ED_ORIGEN} a la ${ED_DESTINO} (version ${venta.program_version_id} -> ${PV_DESTINO}). Corre con --aplicar.`)
  await pool.end()
  process.exit(0)
}

// -- 3. La venta se muda de edicion y de version --------------------------
await q(`UPDATE enrollments
            SET program_edition_id = $1, program_version_id = $2,
                modification_date = NOW(), user_modification_id = $3
          WHERE enrollment_id = $4`, [ED_DESTINO, PV_DESTINO, USER_ID, VENTA])

// -- 4. Bitacora ----------------------------------------------------------
// action 'edition_reprogrammed' + el ancla old_edition_id no son decorativos: es
// como classroomStudentsHistory la sigue mostrando en el aula de origen aunque su
// fila ya no apunte ahi (edition.repository.js).
await repo.logAudit({
  enrollmentId: VENTA,
  action: 'edition_reprogrammed',
  userId: USER_ID,
  justificacion: JUSTIFICACION,
  changes: {
    Version: { old: 'GEST PROYECT I (PY-CZ-06)', new: 'GEST PROYECT (PY-CZ-07)' },
    Edicion: { old: `E6-26 (ed. ${ED_ORIGEN}, 26/08/2026, cancelada A5)`, new: `E1-26 (ed. ${ED_DESTINO}, 26/08/2026)` },
    old_edition_id: ED_ORIGEN,
    new_edition_id: ED_DESTINO
  },
  details: `Reubicacion interna PY-CZ-06 -> PY-CZ-07: la venta venia de GESTION DE PROYECTOS I E6-26 (ed. ${ED_ORIGEN}), cancelada A5 y nunca migrada. Se mantiene la misma inscripcion y el mismo pago (S/247 al contado, con gift card de S/40). Sin Odoo y sin correo por pedido de FICO: el aula vieja de Odoo se coordina a mano.`
})

repo.refreshMv('reubicacion-3136')

// -- 5. Verificacion ------------------------------------------------------
const { rows: final } = await q(`
  SELECT e.enrollment_id, e.program_edition_id, pe.specific_code AS edicion,
         pv.version_code, ts.description AS estado, e.total_amount
    FROM enrollments e
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN catalog ts ON ts.catalog_id = e.cat_type_status
   WHERE e.enrollment_id = $1`, [VENTA])
console.table(final)

await pool.end()
process.exit(0)
