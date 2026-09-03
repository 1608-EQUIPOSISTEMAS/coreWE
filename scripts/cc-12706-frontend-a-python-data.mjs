// Traslado de la inscripcion #12706 (ISAAC VILCHEZ CACERES, DNI 45589067) desde
// ESP. DESARROLLO FRONT END E8-26 hacia ESP. PYTHON: DATA SCIENCE E11-26
// (edicion 15871, inicio 29/08/2026), con S/. 96.00 de diferencia financiados en
// UNA cuota al 15/09/2026 y sin pago inicial.
//
// Va por courseChange (no por reprogramEdition): el destino es OTRO programa y
// el RP rechaza por diseno una edicion de otra version. El origen queda en CC
// conservando sus S/. 640.00 y su fila en course_changes con la diferencia.
//
// Dos ajustes despues del caso de uso, porque el SP no los sabe hacer:
//  1. sp_fico_enrollment_register_direct solo arma plan de cuotas cuando hay
//     adelanto > 0; con inicial 0 cae al contado y crea la cuota como PAGADA
//     con su fila en payments. Aca se convierte en pendiente al 15/09 y el pago
//     que nunca existio se da de baja (active = N, mismo criterio que el pago
//     5491 del origen).
//  2. El correo se difiere: courseChange lo manda apenas crea el destino, o sea
//     ANTES del ajuste, y la plantilla solo lista la tabla de cuotas cuando el
//     plan es "Cuotas". Enviarlo ahi seria mandarle al alumno un correo sin la
//     unica cuota que tiene que pagar.
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
// Sin el bootstrap logAudit es un no-op silencioso y la operacion queda sin bitacora.
import '../src/modules/fico/fico.bootstrap.js'
import { pool } from '../src/config/db.js'
import { setEnrollmentPorts, enrollmentRepository } from '../src/modules/fico/enrollment/enrollment.repository.js'
import { sendConfirmationEmail } from '../src/modules/fico/email-confirmation/email-confirmation.usecases.js'
import { logAudit } from '../src/modules/fico/audit/audit.usecases.js'
import { courseChange } from '../src/modules/fico/enrollment/enrollment.usecases.js'

const ORIGEN = 12706
const VERSION_DESTINO = 42       // BI-EZ-06 - ESP. PYTHON: DATA SCIENCE
const EDICION_DESTINO = 15871    // E11-26, inicio 29/08/2026
const MONTO_DIFERENCIA = 96
const VENCIMIENTO_CUOTA = '2026-09-15'
const USER_ID = 9                // ADMIN
const CUOTAS_CAT = 2467          // we_payment_way_installments
const PENDIENTE_CAT = 4452       // we_inst_pending
const JUSTIFICACION =
  'Traslado del alumno de la ESP. DESARROLLO FRONT END E8-26 a la ESP. PYTHON: ' +
  'DATA SCIENCE E11-26 (inicio 29/08/2026). La diferencia de S/. 96.00 queda ' +
  'financiada en una cuota al 15/09/2026, sin pago inicial. Autorizado por FICO.'

const q = (text, params) => pool.query(text, params)

// Ensayo contra la BD local (CLAUDE.md: primero pruebas). Odoo y ZeptoMail son
// los de PRODUCCION incluso corriendo contra system_erp_dev: cancelar la orden
// de venta real o mandarle el correo al alumno no se puede ensayar, asi que los
// tres efectos hacia afuera se cortan aca.
const ENSAYO = process.env.ENSAYO === '1'
if (ENSAYO) {
  setEnrollmentPorts({ enrollInOdoo: async () => ({ success: false, ensayo: true }) })
  enrollmentRepository.unenrollFromOldOdoo = async () => {}
}

const arbol = async () => {
  const { rows: enrollments } = await q(`
    SELECT * FROM public.enrollments
     WHERE enrollment_id = $1 OR parent_enrollment_id = $1
     ORDER BY parent_enrollment_id NULLS FIRST, enrollment_id`, [ORIGEN])
  const ids = enrollments.map(r => r.enrollment_id)
  const { rows: cuotas } = await q('SELECT * FROM public.payment_installments WHERE enrollment_id = ANY($1::int[])', [ids])
  const { rows: pagos } = await q('SELECT * FROM public.payments WHERE enrollment_id = ANY($1::int[])', [ids])
  return { enrollments, cuotas, pagos }
}

// -- 1. Respaldo ----------------------------------------------------------
const respaldo = await arbol()
writeFileSync(new URL('./_backup_cc_12706.json', import.meta.url), JSON.stringify(respaldo, null, 2))
console.log(`Respaldo: ${respaldo.enrollments.length} enrollments, ${respaldo.cuotas.length} cuotas, ${respaldo.pagos.length} pagos`)

// -- 2. Guarda de idempotencia --------------------------------------------
const { rows: [estado] } = await q(`
  SELECT c.alias FROM public.enrollments e
    JOIN public."catalog" c ON c.catalog_id = e.cat_type_status
   WHERE e.enrollment_id = $1`, [ORIGEN])
if (estado?.alias !== 'we_inscription_way_act') {
  console.error(`ABORTA: #${ORIGEN} ya no esta en ACT (esta en ${estado?.alias}). Nada que hacer.`)
  await pool.end()
  process.exit(1)
}

// -- 3. Cambio de curso, con el correo diferido ----------------------------
setEnrollmentPorts({ sendConfirmationEmail: async () => ({ success: false, deferred: true }) })

const res = await courseChange({
  enrollmentId: ORIGEN,
  newProgramVersionId: VERSION_DESTINO,
  newEditionId: EDICION_DESTINO,
  totalAmount: MONTO_DIFERENCIA,
  justificacion: JUSTIFICACION,
  userId: USER_ID
})
const destino = res.new_enrollment_id
console.log(`${res.message} | destino #${destino}`)

// -- 4. Inicial 0 + una cuota pendiente al 15/09 --------------------------
await q('UPDATE public.enrollments SET cat_payment_plan = $1 WHERE enrollment_id = $2', [CUOTAS_CAT, destino])
const { rowCount: pagosBaja } = await q(
  `UPDATE public.payments SET active = 'N' WHERE enrollment_id = $1 AND active = 'Y'`, [destino])
const { rows: cuotasFix } = await q(`
  UPDATE public.payment_installments
     SET installment_number = 1, amount = $2, due_date = $3::date, cat_status = $4,
         notes = 'Cuota 1 - Pendiente'
   WHERE enrollment_id = $1
   RETURNING installment_id, amount, due_date, cat_status`, [destino, MONTO_DIFERENCIA, VENCIMIENTO_CUOTA, PENDIENTE_CAT])
console.log(`Ajuste: ${pagosBaja} pago(s) dado(s) de baja, cuota ->`, cuotasFix)

await logAudit({
  enrollmentId: destino,
  action: 'installment_plan_adjusted',
  userId: USER_ID,
  justificacion: JUSTIFICACION,
  changes: {
    'Plan de pago': { old: 'Al contado', new: 'Cuotas' },
    Inicial: { old: `S/. ${MONTO_DIFERENCIA.toFixed(2)} pagado`, new: 'S/. 0.00' },
    'Cuota 1': { old: '---', new: `S/. ${MONTO_DIFERENCIA.toFixed(2)} al ${VENCIMIENTO_CUOTA}` }
  },
  details: `Diferencia del cambio de curso financiada: sin pago inicial, una cuota de S/. ${MONTO_DIFERENCIA.toFixed(2)} con vencimiento ${VENCIMIENTO_CUOTA}`
})

// -- 5. Correo, ya con la cuota adentro -----------------------------------
// El propio usecase deja el 'email_sent' en la bitacora: no se duplica aca.
setEnrollmentPorts({ sendConfirmationEmail })
const correo = ENSAYO ? { ensayo: true } : await sendConfirmationEmail({ enrollmentId: destino })
console.log('Correo:', correo)

// -- 6. Verificacion ------------------------------------------------------
const { rows: final } = await q(`
  SELECT e.enrollment_id, e.parent_enrollment_id, p.program_name, pe.specific_code,
         pe.start_date, cts.alias AS estado, cpp.description AS plan,
         e.total_amount, e.odoo_user_id, e.odoo_order_id
    FROM public.enrollments e
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = COALESCE(pe.program_version_id, e.program_version_id)
    LEFT JOIN public.programs p ON p.program_id = pv.program_id
    LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
    LEFT JOIN public."catalog" cpp ON cpp.catalog_id = e.cat_payment_plan
   WHERE e.enrollment_id IN ($1, $2) OR e.parent_enrollment_id IN ($1, $2)
   ORDER BY e.enrollment_id`, [ORIGEN, destino])
console.table(final)
const { rows: cuotasFinales } = await q(`
  SELECT pi.enrollment_id, pi.installment_number, pi.amount, pi.due_date, c.description AS estado
    FROM public.payment_installments pi
    LEFT JOIN public."catalog" c ON c.catalog_id = pi.cat_status
   WHERE pi.enrollment_id IN ($1, $2) ORDER BY pi.enrollment_id, pi.due_date`, [ORIGEN, destino])
console.table(cuotasFinales)
const { rows: bitacora } = await q(`
  SELECT enrollment_id, action, performed_at FROM public.enrollment_audit_log
   WHERE enrollment_id IN ($1, $2) ORDER BY performed_at DESC LIMIT 12`, [ORIGEN, destino])
console.table(bitacora)

await pool.end()
process.exit(0)
