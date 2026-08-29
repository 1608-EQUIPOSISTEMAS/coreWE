// One-off (2026-08-28): el hijo SEG 18090 (KPIS Y OKRS de POMIER SIERRA, padre 9940)
// se creo en la cohorte E65 (09/07) y debe cursar la del 09/08. Es un simple cambio
// de aula de un hijo: se mueve program_edition_id y punto. El flujo RP no aplica
// (ese es para el padre y su plan de pagos; el hijo va en 0.00).
//
// El edition_override que quedo de la correccion anterior se mueve junto: si apunta
// a la edicion vieja, un futuro createChildEnrollments contradice al enrollment.
//
// La edicion destino NO se hardcodea: se resuelve por curso + fecha de inicio, y
// aborta si no hay exactamente una. Solo PRODUCCION, por pedido explicito.
//
//   node scripts/mover-18090-kpis-e66.mjs            # DRY-RUN
//   node scripts/mover-18090-kpis-e66.mjs --aplicar  # aplica
import { q, pool } from './_prod.mjs'

const HIJO = 18090
const PV_KPIS = 58
const INICIO_DESTINO = '2026-08-09'
const aplicar = process.argv.includes('--aplicar')

const estado = () => q(`
  SELECT e.enrollment_id, e.parent_enrollment_id AS padre, pv.abbreviation AS modulo,
         e.program_edition_id AS edicion, pe.global_code, pe.start_date::date AS inicio,
         e.total_amount, c.description AS estado
    FROM enrollments e
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN catalog c ON c.catalog_id = e.cat_type_status
   WHERE e.enrollment_id = $1`, [HIJO]).then(r => r.rows)

const [antes] = await estado()
if (!antes) { console.error(`No existe el enrollment ${HIJO}`); await pool.end(); process.exit(1) }

const { rows: destinos } = await q(
  `SELECT edition_num_id, global_code FROM program_editions
    WHERE program_version_id = $1 AND start_date::date = $2 AND active = 'Y'`,
  [PV_KPIS, INICIO_DESTINO])
if (destinos.length !== 1) {
  console.error(`Esperaba 1 edicion de KPIS Y OKRS que arranque el ${INICIO_DESTINO}, encontre ${destinos.length}.`)
  await pool.end(); process.exit(1)
}
const destino = destinos[0]

console.log('--- antes ---'); console.table([antes])
console.log(`--- destino --- ${destino.global_code} (edicion ${destino.edition_num_id}), inicio ${INICIO_DESTINO}`)

if (Number(antes.edicion) === Number(destino.edition_num_id)) {
  console.log('\nYa esta en esa edicion: nada que hacer (idempotente).')
  await pool.end(); process.exit(0)
}

if (!aplicar) {
  console.log('\nDRY-RUN. Correr con --aplicar.')
  await pool.end(); process.exit(0)
}

await q(
  `UPDATE enrollments SET program_edition_id = $1, modification_date = NOW() WHERE enrollment_id = $2`,
  [destino.edition_num_id, HIJO])

await q(
  `UPDATE enrollment_validations SET custom_edition_id = $1
    WHERE enrollment_id = $2 AND child_version_id = $3 AND validation_type = 'edition_override'`,
  [destino.edition_num_id, antes.padre, PV_KPIS])

await q(
  `INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, details)
   VALUES ($1, 'edition_changed', 9, $2)`,
  [HIJO, `Modulo movido de la edicion ${antes.global_code} (${antes.inicio}) a ${destino.global_code} (${INICIO_DESTINO}) a pedido de FICO`])

console.log('--- despues ---'); console.table(await estado())
await pool.end()
process.exit(0)
