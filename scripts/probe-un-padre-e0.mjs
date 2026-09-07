// Un caso completo de padre E0 sin hijos, con TODOS los campos que podrian
// significar "este alumno ya no va": estado, estado FICO, motivo de anulacion,
// notas, y la bitacora entera. Sirve para que negocio confirme si de verdad
// esta vivo o si el filtro se quedo corto.
//
//   node scripts/probe-un-padre-e0.mjs [enrollment_id]
import { q, pool } from './prod-db.mjs'

const id = Number(process.argv[2]) || null

const elegido = id ?? (await q(`
  SELECT e.enrollment_id
    FROM enrollments e
    JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    JOIN catalog cf ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
    LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
   WHERE e.active = 'Y' AND e.program_edition_id IS NULL
     AND EXISTS (SELECT 1 FROM program_version_structure s WHERE s.parent_program_version_id = pv.program_version_id)
     AND NOT EXISTS (SELECT 1 FROM enrollments h WHERE h.parent_enrollment_id = e.enrollment_id AND h.active = 'Y')
     AND (cts.alias IS NULL OR cts.alias NOT IN ('we_enrollment_status_retired','we_enrollment_status_course_changed','we_enrollment_status_reprogrammed'))
     -- CLAVE: excluir a los que igual entraron al aula por una inscripcion
     -- suelta del modulo. Sin esto el "caso de ejemplo" sale del grupo
     -- equivocado (paso con 15506, que si esta en POWER APPS Y AUT. E6-26).
     AND NOT EXISTS (
       SELECT 1 FROM enrollments o
         JOIN customers co ON co.customer_id = o.customer_id
         JOIN customers ch ON ch.customer_id = e.customer_id AND ch.person_id = co.person_id
         JOIN catalog cfo ON cfo.catalog_id = o.cat_fico_status AND cfo.alias = 'we_enrollment_status_checked'
         JOIN program_versions ov ON ov.program_version_id = o.program_version_id
         JOIN program_version_structure s2 ON s2.parent_program_version_id = pv.program_version_id
         JOIN program_versions mv ON mv.program_version_id = s2.child_program_version_id
        WHERE o.active = 'Y' AND o.program_edition_id IS NOT NULL
          AND ov.program_id = mv.program_id)
   ORDER BY e.registration_date DESC LIMIT 1`)).rows[0].enrollment_id

const { rows: [e] } = await q(`
  SELECT e.enrollment_id, e.registration_date::date AS venta,
         TRIM(concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS alumno,
         per.document_number AS dni, pv.abbreviation AS paquete,
         e.total_amount::numeric AS total, e.list_price::numeric AS lista,
         cts.description AS estado_alumno, cts.alias AS estado_alias,
         cf.description AS estado_fico,
         can.description AS motivo_anulacion,
         ccert.description AS certificado,
         e.active, e.program_edition_id, e.odoo_user_id, e.notes
    FROM enrollments e
    JOIN customers cu ON cu.customer_id = e.customer_id
    JOIN persons per ON per.person_id = cu.person_id
    JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
    LEFT JOIN catalog cf ON cf.catalog_id = e.cat_fico_status
    LEFT JOIN catalog can ON can.catalog_id = e.cat_anulment_reason
    LEFT JOIN catalog ccert ON ccert.catalog_id = e.cat_certificate_status
   WHERE e.enrollment_id = $1`, [elegido])

console.log('=== EL CASO ===')
console.log(e)

console.log('\n=== Modulos del paquete que compro ===')
console.table((await q(`
  SELECT mv.abbreviation AS modulo, s.sort_order AS orden
    FROM enrollments e
    JOIN program_version_structure s ON s.parent_program_version_id = e.program_version_id
    JOIN program_versions mv ON mv.program_version_id = s.child_program_version_id
   WHERE e.enrollment_id = $1 ORDER BY s.sort_order`, [elegido])).rows)

console.log('\n=== Cuotas y pagos ===')
console.table((await q(`
  SELECT pi.installment_number AS cuota, pi.amount, pi.due_date::date AS vence,
         cs.description AS estado,
         (SELECT COUNT(*) FROM payments p WHERE p.installment_id = pi.installment_id AND p.active='Y')::int AS pagos
    FROM payment_installments pi
    LEFT JOIN catalog cs ON cs.catalog_id = pi.cat_status
   WHERE pi.enrollment_id = $1 ORDER BY pi.installment_number`, [elegido])).rows)

console.log('\n=== Bitacora FICO (enrollment_audit_log) ===')
console.table((await q(`
  SELECT al.action, u.alias AS quien, al.performed_at::date AS cuando, LEFT(COALESCE(al.details,''), 60) AS detalle
    FROM enrollment_audit_log al LEFT JOIN users u ON u.user_id = al.performed_by
   WHERE al.enrollment_id = $1 ORDER BY al.performed_at`, [elegido])).rows)

console.log('\n=== Otras inscripciones de la MISMA persona ===')
console.table((await q(`
  SELECT o.enrollment_id AS id, pv2.abbreviation AS programa, pe.specific_code AS ed,
         pe.start_date::date AS inicio, cts2.description AS estado, o.active
    FROM enrollments e
    JOIN customers cu ON cu.customer_id = e.customer_id
    JOIN customers c2 ON c2.person_id = cu.person_id
    JOIN enrollments o ON o.customer_id = c2.customer_id AND o.enrollment_id <> e.enrollment_id
    LEFT JOIN program_versions pv2 ON pv2.program_version_id = o.program_version_id
    LEFT JOIN program_editions pe ON pe.edition_num_id = o.program_edition_id
    LEFT JOIN catalog cts2 ON cts2.catalog_id = o.cat_type_status
   WHERE e.enrollment_id = $1 ORDER BY o.enrollment_id`, [elegido])).rows)

console.log('\n=== Angulo ciego: ¿cuantos de los 72 traen motivo de anulacion? ===')
console.table((await q(`
  SELECT COALESCE(can.description, '(sin motivo de anulacion)') AS motivo, COUNT(*)::int AS padres
    FROM enrollments e
    JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    JOIN catalog cf ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
    LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
    LEFT JOIN catalog can ON can.catalog_id = e.cat_anulment_reason
   WHERE e.active = 'Y' AND e.program_edition_id IS NULL
     AND EXISTS (SELECT 1 FROM program_version_structure s WHERE s.parent_program_version_id = pv.program_version_id)
     AND NOT EXISTS (SELECT 1 FROM enrollments h WHERE h.parent_enrollment_id = e.enrollment_id AND h.active = 'Y')
     AND (cts.alias IS NULL OR cts.alias NOT IN ('we_enrollment_status_retired','we_enrollment_status_course_changed','we_enrollment_status_reprogrammed'))
   GROUP BY 1 ORDER BY padres DESC`)).rows)

console.log('\n=== Y los estados que SI tienen esos 72 ===')
console.table((await q(`
  SELECT COALESCE(cts.description, '(sin estado)') AS estado_alumno, COUNT(*)::int AS padres
    FROM enrollments e
    JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    JOIN catalog cf ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
    LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
   WHERE e.active = 'Y' AND e.program_edition_id IS NULL
     AND EXISTS (SELECT 1 FROM program_version_structure s WHERE s.parent_program_version_id = pv.program_version_id)
     AND NOT EXISTS (SELECT 1 FROM enrollments h WHERE h.parent_enrollment_id = e.enrollment_id AND h.active = 'Y')
     AND (cts.alias IS NULL OR cts.alias NOT IN ('we_enrollment_status_retired','we_enrollment_status_course_changed','we_enrollment_status_reprogrammed'))
   GROUP BY 1 ORDER BY padres DESC`)).rows)

await pool.end()
