// Backfill de res.partner.names / surnames / name en Odoo.
//
// Dos arreglos, cada uno con su propia guarda:
//   1. names/surnames iban SIEMPRE vacios (nunca se escribieron). La ficha de
//      Estudiante y Certificacion leen de ahi. Se completan si ambos estan vacios.
//   2. `name` se armaba sin el apellido materno ("CUEVA BIANCA" en vez de
//      "CUEVA VARGAS BIANCA"). Se corrige SOLO si el valor actual es exactamente
//      el que producia la formula vieja (apellido paterno + nombres): asi se
//      arregla lo que escribimos nosotros y no se pisa ninguna edicion manual.
//
// Idempotente: correrlo dos veces no cambia nada la segunda vez.
//
// Uso (desde Backend/, con el tunel SSH arriba y ODOO_* en .env):
//   node scripts/backfill-odoo-names.mjs            # dry-run: solo lista
//   node scripts/backfill-odoo-names.mjs --apply    # escribe en Odoo
//   node scripts/backfill-odoo-names.mjs --apply --since 2026-07-01
import { q, pool } from './db.mjs'
import odoo from '../src/config/odooClient.js'
import { buildOdooNameParts } from '../src/utils/fico-odoo.helper.js'

const APPLY = process.argv.includes('--apply')
const sinceIdx = process.argv.indexOf('--since')
const SINCE = sinceIdx > -1 ? process.argv[sinceIdx + 1] : null

const { rows } = await q(`
  SELECT DISTINCT ON (e.odoo_user_id)
         e.odoo_user_id, e.enrollment_id,
         per.first_name, per.last_name, per.mother_last_name
    FROM enrollments e
    JOIN customers cust ON cust.customer_id = e.customer_id
    JOIN persons per    ON per.person_id = cust.person_id
   WHERE e.odoo_user_id IS NOT NULL
     AND ($1::date IS NULL OR e.registration_date >= $1::date)
   ORDER BY e.odoo_user_id, e.enrollment_id DESC
`, [SINCE])

console.log(`${rows.length} usuarios Odoo a revisar${SINCE ? ` (desde ${SINCE})` : ''}. Modo: ${APPLY ? 'APPLY' : 'dry-run'}`)

let escritos = 0, sinCambios = 0, fallidos = 0, nombresCorregidos = 0
for (const r of rows) {
  const { names, surnames } = buildOdooNameParts({
    firstName: r.first_name,
    lastName: r.last_name,
    motherLastName: r.mother_last_name
  })
  if (!names && !surnames) continue

  // Nombre completo correcto vs. el que producia la formula vieja (sin materno).
  const fullName = `${surnames} ${names}`.trim()
  const legacyName = buildOdooNameParts({ firstName: r.first_name, lastName: r.last_name })
  const legacyFullName = `${legacyName.surnames} ${legacyName.names}`.trim()

  try {
    const [user] = await odoo.callKw('res.users', 'read', [[r.odoo_user_id], ['partner_id']])
    const partnerId = user?.partner_id?.[0]
    if (!partnerId) { console.warn(`user ${r.odoo_user_id}: sin partner`); fallidos++; continue }

    const [partner] = await odoo.callKw('res.partner', 'read', [[partnerId], ['names', 'surnames', 'name']])
    const vals = {}

    if (!(partner?.names || '').trim() && !(partner?.surnames || '').trim()) {
      vals.names = names
      vals.surnames = surnames
    }
    // Solo tocar el name si es exactamente lo que escribio la formula vieja.
    const actual = String(partner?.name || '').trim().toUpperCase()
    if (actual === legacyFullName && fullName !== legacyFullName) {
      vals.name = fullName
      nombresCorregidos++
    }

    if (Object.keys(vals).length === 0) { sinCambios++; continue }

    const detalle = [
      vals.names !== undefined ? `names="${vals.names}" surnames="${vals.surnames}"` : null,
      vals.name !== undefined ? `name: "${partner.name}" -> "${vals.name}"` : null
    ].filter(Boolean).join(' | ')
    console.log(`${APPLY ? 'ESCRIBE' : 'PENDIENTE'} partner ${partnerId} -> ${detalle}`)
    if (APPLY) await odoo.callKw('res.partner', 'write', [[partnerId], vals])
    escritos++
  } catch (err) {
    console.error(`enrollment ${r.enrollment_id} / user ${r.odoo_user_id}:`, err.message)
    fallidos++
  }
}

console.log(`\nResumen -> partners ${APPLY ? 'escritos' : 'pendientes'}: ${escritos} (de ellos, name corregido: ${nombresCorregidos}) | sin cambios: ${sinCambios} | fallidos: ${fallidos}`)
await pool.end()
