// Corrige la edicion del enrollment 17014: quedo en E37 (E8-26, 05/09/2026) por
// un error del asesor al registrar; la venta corresponde a E38 (E9-26, 08/10/2026).
//
// NO es un RP: no hay traslado de cuotas, ni correo, ni desinscripcion de Odoo
// (la inscripcion ni siquiera llego a Odoo: odoo_user_id/order_id estan nulos).
// Es una correccion de dato, asi que se mueve program_edition_id y se deja la
// entrada en enrollment_audit_log con la misma forma que escribe editEnrollment
// (action 'edited' + changes jsonb + details + justificacion).
//
//   node scripts/cambiar-edicion-17014.mjs --dry   # muestra el plan, no guarda
//   node scripts/cambiar-edicion-17014.mjs         # aplica
import fs from 'node:fs'
import { q, pool } from './_prod.mjs'

const ENROLLMENT_ID = 17014
const FECHA_DESTINO = '2026-10-08'
const JUSTIFICACION = 'Cambio de fecha por solicitud del asesor AE30 (ARLETH): error del asesor al registrar la inscripcion.'
// La correccion se aplica desde el lado administrativo, no la ejecuta el asesor:
// firma ADMIN, que es quien firma el resto de correcciones de la bitacora.
const ALIAS_AUTOR = 'ADMIN'
const APLICAR = !process.argv.includes('--dry')

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)
const fmt = (d) => (iso(d) ? iso(d).split('-').reverse().join('/') : '---')
// Misma etiqueta que muestra la ficha: codigo global + fecha de inicio.
const etiqueta = (ed) => `${ed.global_code} (${ed.specific_code}) - ${fmt(ed.start_date)}`

const { rows: [actual] } = await q(`
  SELECT e.enrollment_id, e.program_edition_id, e.program_version_id, e.parent_enrollment_id,
         ed.global_code, ed.specific_code, ed.start_date, pv.program_id, p.program_name AS programa
    FROM enrollments e
    JOIN program_editions ed ON ed.edition_num_id = e.program_edition_id
    JOIN program_versions pv ON pv.program_version_id = ed.program_version_id
    JOIN programs p ON p.program_id = pv.program_id
   WHERE e.enrollment_id = $1`, [ENROLLMENT_ID])

if (!actual) throw new Error(`No existe el enrollment ${ENROLLMENT_ID} (o no tiene edicion)`)

console.log(`Inscripcion ${ENROLLMENT_ID} | ${actual.programa}`)
console.log(`Edicion actual: ${etiqueta(actual)} (id ${actual.program_edition_id})`)

const { rows: candidatas } = await q(`
  SELECT ed.edition_num_id, ed.program_version_id, ed.global_code, ed.specific_code, ed.start_date
    FROM program_editions ed
    JOIN program_versions pv ON pv.program_version_id = ed.program_version_id
   WHERE pv.program_id = $1 AND ed.start_date::date = $2::date AND ed.active = 'Y'
   ORDER BY ed.edition_num_id`, [actual.program_id, FECHA_DESTINO])

if (candidatas.length !== 1) {
  throw new Error(`Esperaba 1 edicion que arranque el ${FECHA_DESTINO}, encontre ${candidatas.length}. Elegir a mano.`)
}
const destino = candidatas[0]
console.log(`Edicion destino: ${etiqueta(destino)} (id ${destino.edition_num_id})`)

// El enrollment guarda la version aparte de la edicion: si la edicion destino
// cuelga de otra version, mover solo la edicion deja la venta descuadrada.
const versionCambia = destino.program_version_id !== actual.program_version_id
if (versionCambia) console.log(`OJO: la version tambien cambia ${actual.program_version_id} → ${destino.program_version_id}`)

// El usuario que firma la bitacora. Sin el, la timeline muestra la accion sin autor.
const { rows: [autor] } = await q(
  'SELECT user_id, alias FROM users WHERE alias = $1 AND active = $2 LIMIT 1', [ALIAS_AUTOR, 'Y'])
if (!autor) throw new Error(`No existe el usuario ${ALIAS_AUTOR}: la bitacora quedaria sin autor.`)
console.log(`Autor de la bitacora: ${autor.alias} (${autor.user_id})`)

const changes = { Edicion: { old: etiqueta(actual), new: etiqueta(destino) } }
const details = `Edicion: ${changes.Edicion.old} → ${changes.Edicion.new}`
console.log(`Bitacora: ${details}`)
console.log(`Justificacion: ${JUSTIFICACION}`)

if (!APLICAR) {
  console.log('\n--dry: no se guardo nada.')
  await pool.end()
  process.exit(0)
}

fs.writeFileSync(
  new URL('./_backup_17014_edicion.json', import.meta.url),
  JSON.stringify({ antes: actual, destino, ts: new Date().toISOString() }, null, 2)
)

const cliente = await pool.connect()
try {
  await cliente.query('BEGIN')
  // Compare-and-swap: si alguien ya movio la edicion, esto no toca nada y aborta.
  const { rowCount } = await cliente.query(`
    UPDATE enrollments
       SET program_edition_id = $1, program_version_id = $2,
           user_modification_id = $3, modification_date = NOW()
     WHERE enrollment_id = $4 AND program_edition_id = $5`,
  [destino.edition_num_id, destino.program_version_id, autor.user_id,
    ENROLLMENT_ID, actual.program_edition_id])
  if (rowCount !== 1) throw new Error(`El UPDATE toco ${rowCount} filas: alguien movio la edicion, aborto.`)

  await cliente.query(`
    INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
    VALUES ($1, 'edited', $2, $3, $4::jsonb, $5)`,
  [ENROLLMENT_ID, autor.user_id, JUSTIFICACION, JSON.stringify(changes), details])

  await cliente.query('COMMIT')
  console.log('\nOK: edicion movida y bitacora escrita.')
} catch (err) {
  await cliente.query('ROLLBACK')
  throw err
} finally {
  cliente.release()
}

// El panel de FICO lee la cabecera de la matview, no de la tabla.
await q('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_enrollment_report_system')
  .catch(() => q('REFRESH MATERIALIZED VIEW mv_enrollment_report_system'))
console.log('Matview mv_enrollment_report_system refrescada.')

await pool.end()
