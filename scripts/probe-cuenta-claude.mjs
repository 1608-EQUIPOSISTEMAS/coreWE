// Sondeo: beneficio "CUENTA CLAUDE" (badge CUENTA PERSONAL del panel FICO) y en
// que inscripciones del curso CLAUDE : IA APLICADA (program_id 239) estan los
// correos pedidos.
//
// Hallado:
//   - discounts 49 = 'CUENTA CLAUDE', cat_discount_type 2495 = "Beneficio
//     adicional", value 100.00. El badge se dispara por el TEXTO de la
//     descripcion (useEnrollmentFormatters.hasClaudeAccount), no por el monto.
//   - Los 8 casos ya existentes van con order_applied = 3 y
//     calculated_amount = 100.00, es decir DESCUENTAN S/100 reales.
//   - El correo del alumno sale de leads.origin_email o person_contacts
//     (utils/student-contacts.sql.js), no de customers/persons.
import { q, pool } from './db.mjs'

const EMAILS = [
  'mauricio10019@gmail.com',
  'pedroangel20082001ci@gmail.com',
  'rolly.str.03@gmail.com',
  'huaytr7@gmail.com',
  'victoria.magaly.perez@gmail.com',
  'johnespinozak96@gmail.com',
  'jesuscelisarias@gmail.com',
]

const show = (titulo, rows) => {
  console.log(`\n=== ${titulo} (${rows.length}) ===`)
  console.table(rows)
}

// Join canonico correo -> inscripcion (espejo de enrollment.repository.js:510).
const BASE = `
  FROM enrollments e
  JOIN customers cust ON cust.customer_id = e.customer_id
  JOIN persons per    ON per.person_id = cust.person_id
  LEFT JOIN leads l   ON l.enrollment_id = e.enrollment_id
  LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
  LEFT JOIN programs prog       ON prog.program_id = pv.program_id
  LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
  WHERE LOWER(COALESCE(
          l.origin_email,
          (SELECT pc.value FROM person_contacts pc
            WHERE pc.person_id = per.person_id
              AND pc.cat_way_contact = (SELECT catalog_id FROM catalog WHERE alias = 'we_way_contact_email' LIMIT 1)
              AND pc.active = 'Y'
            ORDER BY pc.registration_date DESC LIMIT 1))) = ANY($1::text[])
    AND prog.program_id = 239   -- CLAUDE : IA APLICADA
`

show('inscripciones de los correos pedidos', (await q(`
  SELECT e.enrollment_id,
         LOWER(COALESCE(l.origin_email, '(person_contacts)')) AS email,
         per.first_name || ' ' || per.last_name AS alumno,
         prog.program_id, prog.program_name AS programa, pe.global_code AS edicion,
         e.parent_enrollment_id, e.list_price, e.discount_amount, e.total_amount,
         EXISTS (SELECT 1 FROM enrollment_discounts d
                  WHERE d.enrollment_id = e.enrollment_id AND d.discount_id = 49) AS ya_tiene
  ${BASE}
  ORDER BY prog.program_id, 2, 1
`, [EMAILS])).rows)

show('descuentos ya aplicados a esas inscripciones', (await q(`
  SELECT ed.enrollment_id, ed.discount_id, d.description, ed.order_applied,
         ed.calculated_amount
  FROM enrollment_discounts ed
  JOIN discounts d ON d.discount_id = ed.discount_id
  WHERE ed.enrollment_id IN (SELECT e.enrollment_id ${BASE})
  ORDER BY ed.enrollment_id, ed.order_applied
`, [EMAILS])).rows)

await pool.end()
