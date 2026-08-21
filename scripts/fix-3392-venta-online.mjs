// One-off (2026-08-21): el enrollment 3392 (JOSE LUIS MINAYA PARIONA, 08/06/2026)
// es una venta ONLINE que quedo registrada contra el curso EN VIVO.
//
// En las primeras semanas de FICO el registro directo no distinguia las dos
// versiones del mismo curso: MICROSOFT EXCEL INTERMEDIO existe como
// EX-CZ-02 (program_version 18, programa 18, modalidad En Vivo) y como
// EX-CO-02 (program_version 133, programa 134, modalidad Online). La venta se
// grabo en la primera.
//
// Consecuencias que esto dejo:
//   - sin program_edition_id, que en un curso en vivo se lee como E0.
//   - el job register_followup #189 murio con "La edicion no tiene fecha de
//     inicio" en el paso odoo => nunca se creo la cuenta de campus
//     (odoo_user_id NULL) ni se envio la confirmacion online.
//   - el correo de confirmacion saldria con la plantilla de curso en vivo.
//
// Correccion de dato, NO un cambio de curso: el alumno compro lo que compro
// (S/ 40 sobre lista 80, el precio del online), solo esta apuntado al producto
// equivocado. Por eso se repunta program_version_id y no se dispara el flujo CC.
//
//   node scripts/fix-3392-venta-online.mjs --dry   # solo muestra
//   node scripts/fix-3392-venta-online.mjs         # aplica
import { q, pool } from './db.mjs'

const ID = 3392
const VERSION_MALA = 18 // EX-CZ-02 EXCEL INTERM (En Vivo)
const VERSION_BUENA = 133 // EX-CO-02 EXCEL INTERMEDIO (Online)
const DRY = process.argv.includes('--dry')

const mostrar = async (titulo, sql, params) => {
  const { rows } = await q(sql, params)
  console.log(`\n${titulo}:`)
  rows.length ? console.table(rows) : console.log('  (sin filas)')
  return rows
}

const ESTADO_SQL = `
  SELECT e.enrollment_id, e.program_version_id, pv.version_code, pv.abbreviation,
         cm.description AS modalidad, e.program_edition_id, e.total_amount,
         e.list_price, e.agent_origin, e.odoo_user_id
    FROM enrollments e
    JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    JOIN programs p ON p.program_id = pv.program_id
    JOIN catalog cm ON cm.catalog_id = p.cat_model_modality
   WHERE e.enrollment_id = $1`

await mostrar('antes', ESTADO_SQL, [ID])
await mostrar(
  'otras compras del mismo alumno (la de mayo si entro como online)',
  `SELECT e.enrollment_id, pv.version_code, pv.abbreviation, cm.description AS modalidad, e.odoo_user_id
     FROM enrollments e
     JOIN customers c ON c.customer_id = e.customer_id
     JOIN program_versions pv ON pv.program_version_id = e.program_version_id
     JOIN programs p ON p.program_id = pv.program_id
     JOIN catalog cm ON cm.catalog_id = p.cat_model_modality
    WHERE c.person_id = (SELECT c2.person_id FROM enrollments e2
                           JOIN customers c2 ON c2.customer_id = e2.customer_id
                          WHERE e2.enrollment_id = $1)
    ORDER BY e.enrollment_id`,
  [ID]
)

if (DRY) {
  console.log(`\n[dry] no se aplico nada. Cambio propuesto: program_version_id ${VERSION_MALA} -> ${VERSION_BUENA}`)
  await pool.end()
  process.exit(0)
}

// El WHERE lleva la version vieja a proposito: si alguien ya lo corrigio, el
// UPDATE no toca nada en vez de pisar una correccion posterior.
const { rows: [actualizado] } = await q(
  `UPDATE enrollments
      SET program_version_id = $1, modification_date = NOW()
    WHERE enrollment_id = $2 AND program_version_id = $3
    RETURNING enrollment_id, program_version_id`,
  [VERSION_BUENA, ID, VERSION_MALA]
)
console.log('\nactualizado:', actualizado ?? 'nada (ya estaba corregido)')

// El panel FICO lee la cabecera de la matview, no de la tabla.
await q('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')
console.log('matview refrescada')

await mostrar('despues', ESTADO_SQL, [ID])

console.log(`
PENDIENTE MANUAL: el alumno sigue sin cuenta de campus (odoo_user_id NULL)
porque el job register_followup #189 murio antes de crearla. Hay que reenviar
la confirmacion desde la pantalla de FICO para que se aprovisione el aula
online y salga el correo con las credenciales.`)

await pool.end()
