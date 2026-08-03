// Inspector de un enrollment ANTES de tocarlo: catalogo de estados, cabecera,
// familia (padre/hijos) y auditoria. Un hijo (parent_enrollment_id no nulo) va SEG
// por diseño, asi que lo primero es saber si es hijo de paquete, destino de CC/RP
// o un padre mal marcado.
//
//   node scripts/ver-enrollment.mjs <enrollment_id>
import { q, pool } from './db.mjs'

const ID = Number(process.argv[2])
if (!ID) { console.error('Uso: node scripts/ver-enrollment.mjs <enrollment_id>'); process.exit(1) }

const est = await q(
  `SELECT catalog_id, catalog_parent_id, description, alias, active
     FROM catalog
    WHERE UPPER(COALESCE(alias,'')) IN ('ACT','SEG','ED','RP','ANU')
       OR UPPER(description) IN ('ACT','SEG','ED','RP','ANU')
    ORDER BY catalog_parent_id, catalog_id`
)
console.log('--- catalogo de estados (ACT/SEG/...) ---')
console.table(est.rows)

const det = await q(
  `SELECT e.enrollment_id, e.parent_enrollment_id, e.customer_id,
          e.program_edition_id, e.membership_program_id,
          e.cat_type_status, ts.description AS estado, ts.alias AS estado_alias,
          e.cat_fico_status, fs.description AS fico,
          e.cat_payment_plan, pp.description AS plan_pago,
          e.total_amount, e.discount_amount, e.active,
          e.registration_date, e.notes
     FROM enrollments e
     LEFT JOIN catalog ts ON ts.catalog_id = e.cat_type_status
     LEFT JOIN catalog fs ON fs.catalog_id = e.cat_fico_status
     LEFT JOIN catalog pp ON pp.catalog_id = e.cat_payment_plan
    WHERE e.enrollment_id = $1`,
  [ID]
)
console.log('--- enrollment', ID, '---')
console.table(det.rows)

if (det.rows.length) {
  const padre = det.rows[0].parent_enrollment_id

  if (padre) {
    const p = await q(
      `SELECT e.enrollment_id, e.cat_type_status, ts.description AS estado,
              e.cat_payment_plan, pp.description AS plan_pago, e.total_amount, e.active
         FROM enrollments e
         LEFT JOIN catalog ts ON ts.catalog_id = e.cat_type_status
         LEFT JOIN catalog pp ON pp.catalog_id = e.cat_payment_plan
        WHERE e.enrollment_id = $1`,
      [padre]
    )
    console.log('--- PADRE', padre, '---')
    console.table(p.rows)

    const herm = await q(
      `SELECT e.enrollment_id, e.cat_type_status, ts.description AS estado,
              e.program_edition_id, e.total_amount
         FROM enrollments e
         LEFT JOIN catalog ts ON ts.catalog_id = e.cat_type_status
        WHERE e.parent_enrollment_id = $1 ORDER BY e.enrollment_id`,
      [padre]
    )
    console.log('--- hermanos (todos los hijos del padre) ---')
    console.table(herm.rows)
  } else {
    console.log('>>> NO tiene parent_enrollment_id: es enrollment RAIZ (no es hijo de paquete)')
  }

  const hijos = await q(
    `SELECT e.enrollment_id, e.cat_type_status, ts.description AS estado, e.program_edition_id
       FROM enrollments e
       LEFT JOIN catalog ts ON ts.catalog_id = e.cat_type_status
      WHERE e.parent_enrollment_id = $1 ORDER BY e.enrollment_id`,
    [ID]
  )
  console.log('--- hijos de', ID, '---')
  console.table(hijos.rows)

  const cuotas = await q(
    `SELECT i.installment_id, i.installment_number, i.amount, i.due_date,
            i.cat_status, c.description AS estado_cuota
       FROM payment_installments i
       LEFT JOIN catalog c ON c.catalog_id = i.cat_status
      WHERE i.enrollment_id = $1 ORDER BY i.installment_number`,
    [ID]
  )
  console.log('--- cuotas ---')
  console.table(cuotas.rows)

  const pagos = await q(
    `SELECT p.payment_id, p.amount, p.payment_date, p.installment_id,
            p.cat_payment_type, c.description AS tipo_pago, p.active
       FROM payments p
       LEFT JOIN catalog c ON c.catalog_id = p.cat_payment_type
      WHERE p.enrollment_id = $1 ORDER BY p.payment_id`,
    [ID]
  )
  console.log('--- pagos ---')
  console.table(pagos.rows)

  const audit = await q(
    `SELECT audit_id, action, performed_by, performed_at, justificacion, changes
       FROM enrollment_audit_log WHERE enrollment_id = $1
      ORDER BY audit_id DESC LIMIT 10`,
    [ID]
  )
  console.log('--- audit log (ultimos 10) ---')
  console.table(audit.rows)
}

await pool.end()
