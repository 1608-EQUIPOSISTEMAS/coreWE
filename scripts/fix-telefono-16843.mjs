// One-off 2026-08-21: el alumno del enrollment 16843 dictó mal su celular.
// El asesor solicita corregirlo a 923106748.
//
// El teléfono está espejado en tres sitios (mismo orden que editStudent en
// fico/enrollment/enrollment.usecases.js:758-772):
//   1. leads.origin_phone      -> gana en vw_enrollment_report_system
//   2. person_contacts         -> fuente de aulas/cronograma
//   3. Odoo res.partner.phone  -> se avisa, se sincroniza desde la UI
// Y el panel FICO lee de la matview mv_enrollment_report_system: sin REFRESH
// el cambio no se ve.
//
// Uso:  node scripts/fix-telefono-16843.mjs            (dry-run: solo muestra)
//       node scripts/fix-telefono-16843.mjs --apply    (escribe)
import { pool } from './db.mjs'
import fs from 'node:fs'

const ENROLLMENT_ID = 16843
const NUEVO_TELEFONO = '923106748'
const JUSTIFICACION = 'Editado a solicitud del asesor: el alumno se equivocó al brindar su número de celular.'
const APLICAR = process.argv.includes('--apply')

const client = await pool.connect()
try {
  const ctx = (await client.query(`
    SELECT e.enrollment_id, e.customer_id, e.parent_enrollment_id, e.odoo_user_id,
           cust.person_id, per.first_name, per.last_name, per.mother_last_name, per.document_number
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons   per  ON per.person_id    = cust.person_id
     WHERE e.enrollment_id = $1`, [ENROLLMENT_ID])).rows[0]
  if (!ctx) throw new Error(`No existe el enrollment ${ENROLLMENT_ID}`)
  console.log('ALUMNO:', ctx)

  // Todas las inscripciones de la persona: el celular es de la persona, no de
  // una venta suelta, así que el lead de cada una tiene que quedar igual.
  const leads = (await client.query(`
    SELECT l.lead_id, l.enrollment_id, l.origin_phone, l.origin_email, l.active
      FROM leads l
      JOIN enrollments e   ON e.enrollment_id = l.enrollment_id
      JOIN customers  cust ON cust.customer_id = e.customer_id
     WHERE cust.person_id = $1
     ORDER BY l.lead_id`, [ctx.person_id])).rows
  console.log('LEADS DE LA PERSONA:', leads)

  const contactos = (await client.query(`
    SELECT pc.person_contact_id, pc.value, pc.active, cat.alias
      FROM person_contacts pc
      JOIN catalog cat ON cat.catalog_id = pc.cat_way_contact
     WHERE pc.person_id = $1
     ORDER BY pc.registration_date DESC`, [ctx.person_id])).rows
  console.log('PERSON_CONTACTS:', contactos)

  const telefonoAnterior =
    leads.find(l => l.enrollment_id === ENROLLMENT_ID)?.origin_phone ||
    contactos.find(c => c.alias === 'we_way_contact_phone')?.value || null
  console.log(`\nCAMBIO: "${telefonoAnterior || '---'}" -> "${NUEVO_TELEFONO}"`)
  if (ctx.odoo_user_id) console.log(`OJO: tiene odoo_user_id=${ctx.odoo_user_id}; Odoo NO se toca desde este script.`)

  if (!APLICAR) { console.log('\n[dry-run] Nada escrito. Correr con --apply.'); process.exit(0) }

  fs.writeFileSync(
    `scripts/_backup_16843_telefono_2026-08-21.json`,
    JSON.stringify({ ctx, leads, contactos, telefonoAnterior, NUEVO_TELEFONO }, null, 2)
  )

  await client.query('BEGIN')

  const upLeads = await client.query(
    `UPDATE leads l SET origin_phone = $1
       FROM enrollments e, customers cust
      WHERE l.enrollment_id = e.enrollment_id
        AND cust.customer_id = e.customer_id
        AND cust.person_id = $2
        AND l.origin_phone IS DISTINCT FROM $1`, [NUEVO_TELEFONO, ctx.person_id])

  const upContactos = await client.query(
    `UPDATE person_contacts
        SET value = $1
      WHERE person_id = $2
        AND cat_way_contact = (SELECT catalog_id FROM catalog WHERE alias = 'we_way_contact_phone' LIMIT 1)
        AND active = 'Y'
        AND value IS DISTINCT FROM $1`, [NUEVO_TELEFONO, ctx.person_id])

  // performed_by = NULL: el Historial lo mostrará como "Sistema" porque la
  // corrección se aplicó en BD, no desde la sesión de un usuario del ERP.
  await client.query(`
    INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
    VALUES ($1, 'edited', NULL, $2, $3::jsonb, $4)`, [
    ENROLLMENT_ID,
    JUSTIFICACION,
    JSON.stringify({ Telefono: { old: telefonoAnterior || '---', new: NUEVO_TELEFONO } }),
    `Telefono: ${telefonoAnterior || '---'} → ${NUEVO_TELEFONO}`
  ])

  await client.query('COMMIT')
  console.log(`OK -> leads: ${upLeads.rowCount}, person_contacts: ${upContactos.rowCount}, audit: 1`)

  // Fuera de la transacción: CONCURRENTLY no corre dentro de un BEGIN.
  await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_enrollment_report_system')
  console.log('Matview mv_enrollment_report_system refrescada.')

  console.log('VERIFICACION:', (await client.query(
    `SELECT "ID", "NOMBRES COMPLETOS", "CELULAR" FROM mv_enrollment_report_system WHERE "ID" = $1`, [ENROLLMENT_ID]
  )).rows)
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  throw err
} finally {
  client.release()
  await pool.end()
}
