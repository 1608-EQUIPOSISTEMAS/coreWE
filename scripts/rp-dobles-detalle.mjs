// Las dos RP ejecutadas dos veces (doble submit): 3585 -> 15997 / 16001 y
// 14884 -> 18922 / 18923. Cada par comparte alumno y edicion pero tiene su
// propia orden de venta en Odoo.
//
// Antes de proponer desactivar una copia hay que saber CUAL es la buena: la que
// se quedo con la cuota trasladada de verdad. La otra deberia tener la cuota
// pago-cero que deja `transferInstallmentsForReprogram` cuando el plan viene
// vacio (en la 2da corrida ya no quedaba nada pendiente que trasladar).
import { q, pool } from './db.mjs'

const FAMILIAS = [
  { origen: 3585, destinos: [15997, 16001] },
  { origen: 14884, destinos: [18922, 18923] }
]

const { rows: [{ db }] } = await q('SELECT current_database() AS db')
console.log('BD:', db, '\n')

for (const { origen, destinos } of FAMILIAS) {
  const ids = [origen, ...destinos]
  console.log(`\n===== FAMILIA ${origen} -> ${destinos.join(' / ')} =====`)

  const { rows: cuotas } = await q(
    `SELECT pi.enrollment_id, pi.installment_id, pi.installment_number, pi.amount,
            pi.due_date, c.alias AS estado, pi.notes
       FROM public.payment_installments pi
       LEFT JOIN public."catalog" c ON c.catalog_id = pi.cat_status
      WHERE pi.enrollment_id = ANY($1)
      ORDER BY pi.enrollment_id, pi.installment_number`,
    [ids]
  )
  console.table(cuotas)

  const { rows: pagos } = await q(
    `SELECT p.enrollment_id, p.payment_id, p.installment_id, p.amount,
            p.payment_date, p.active
       FROM public.payments p
      WHERE p.enrollment_id = ANY($1)
      ORDER BY p.enrollment_id, p.payment_date`,
    [ids]
  )
  console.table(pagos)

  // Hijos SEG: si el job register_followup ya corrio para una de las copias,
  // esa es la que quedo "viva" de verdad y la otra es la cascara.
  const { rows: hijos } = await q(
    `SELECT e.parent_enrollment_id, e.enrollment_id, c.alias AS estado, e.active,
            pv.abbreviation AS programa
       FROM public.enrollments e
       LEFT JOIN public."catalog" c         ON c.catalog_id = e.cat_type_status
       LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
      WHERE e.parent_enrollment_id = ANY($1)
      ORDER BY e.parent_enrollment_id, e.enrollment_id`,
    [ids]
  )
  console.log('hijos SEG:')
  console.table(hijos)

  const { rows: audit } = await q(
    `SELECT enrollment_id, action, performed_at, left(details, 90) AS details
       FROM public.enrollment_audit_log
      WHERE enrollment_id = ANY($1)
      ORDER BY performed_at`,
    [ids]
  )
  console.log('auditoria:')
  console.table(audit)

  // El correo al alumno es lo que no se puede deshacer: si salio por las dos
  // copias, el alumno recibio dos confirmaciones y hay que avisarle.
  const { rows: correos } = await q(
    `SELECT enrollment_id, COUNT(*) AS enviados
       FROM public.enrollment_audit_log
      WHERE enrollment_id = ANY($1) AND action = 'email_sent'
      GROUP BY enrollment_id`,
    [ids]
  )
  console.log('correos enviados:')
  console.table(correos)
}

await pool.end()
