// Ajustes puntuales tras la importación SAP HANA del 2026-07-24, decididos por
// el usuario:
//
// 14366 GARCIA (convalidación E0): la hoja cobró 700 de 855. El SP dejó una sola
//   cuota de 855 en estado "Pagado", así que el sistema no le veía los 155. Se
//   parte en inicial 700 pagada + cuota de 155 pendiente. La hoja no trae fecha
//   para ese saldo: se usa su F. PAGO y queda por confirmar con cobranza.
//
// 14391 VILLAGOMEZ (retirado): entró con total 0 por el bug de "miembro = curso
//   gratis" (era WE PLUS y sí pagó). La hoja dice total 700 con 150 cobrados.
//
// Idempotente: si ya está aplicado, no vuelve a tocar nada.
import { q, pool } from './db.mjs'

const PENDIENTE = 2470
const PAGADA = 4454
const TIPO_PAGO = 3115
const LIQUIDACION_PENDIENTE = 2573
const USER_ID = 9

// --- 14366 GARCIA: 855 = 700 cobrado + 155 pendiente ------------------------
const FECHA_GARCIA = '2025-10-22' // F. PAGO de la hoja; vencimiento a confirmar
const { rows: gCuotas } = await q(
  'SELECT installment_id, installment_number AS n, amount, cat_status FROM public.payment_installments WHERE enrollment_id = 14366 ORDER BY installment_number')

if (gCuotas.length === 1 && Number(gCuotas[0].amount) === 855) {
  const unica = gCuotas[0]
  // La cuota existente pasa a ser la inicial cobrada (700), y el resto sale como
  // cuota 1 pendiente. Se reusa la fila para no perder el pago ya asociado.
  await q('UPDATE public.payment_installments SET installment_number = 0, amount = 700, cat_status = $1 WHERE installment_id = $2',
    [PAGADA, unica.installment_id])
  await q('UPDATE public.payments SET amount = 700 WHERE installment_id = $1', [unica.installment_id])
  const { rows: nueva } = await q(`
    INSERT INTO public.payment_installments (enrollment_id, installment_number, amount, due_date, cat_status, notes)
    VALUES (14366, 1, 155, $1, $2, 'Saldo sin fecha en la hoja FICO: vencimiento por confirmar con cobranza')
    RETURNING installment_id`, [FECHA_GARCIA, PENDIENTE])
  console.log(`14366: cuota unica 855 -> #0 700 pagada + #1 155 pendiente (nueva ${nueva[0].installment_id})`)
} else {
  console.log('14366: ya ajustado o con otra estructura, no se toca:', gCuotas.map(c => `#${c.n}:${c.amount}/${c.cat_status}`).join(' '))
}

// --- 14391 VILLAGOMEZ: total real 700, 150 cobrados -------------------------
const { rows: v } = await q('SELECT total_amount, list_price FROM public.enrollments WHERE enrollment_id = 14391')
if (Number(v[0].total_amount) === 0) {
  await q('UPDATE public.enrollments SET total_amount = 700, list_price = 700, user_modification_id = $1, modification_date = now() WHERE enrollment_id = 14391',
    [USER_ID])
  const { rows: vc } = await q('SELECT installment_id, amount FROM public.payment_installments WHERE enrollment_id = 14391 ORDER BY installment_number')
  // El SP le dejó una cuota de 0 (era "gratis"): pasa a ser la inicial de 150.
  await q('UPDATE public.payment_installments SET installment_number = 0, amount = 150, cat_status = $1 WHERE installment_id = $2',
    [PAGADA, vc[0].installment_id])
  await q(`INSERT INTO public.payments (enrollment_id, installment_id, amount, payment_date, cat_payment_type,
                                        cat_settlement_status, active, user_registration_id)
           VALUES (14391, $1, 150, '2026-03-11', $2, $3, 'Y', $4)`,
  [vc[0].installment_id, TIPO_PAGO, LIQUIDACION_PENDIENTE, USER_ID])
  await q(`INSERT INTO public.payment_installments (enrollment_id, installment_number, amount, due_date, cat_status, notes)
           VALUES (14391, 1, 550, '2026-03-11', $1, 'Saldo al momento del retiro segun la hoja FICO')`, [PENDIENTE])
  console.log('14391: total 0 -> 700 | #0 150 pagada + #1 550 pendiente')
} else {
  console.log('14391: ya ajustado (total', v[0].total_amount + '), no se toca')
}

await q('REFRESH MATERIALIZED VIEW public.mv_enrollment_report_system')
console.log('matview refrescada')
await pool.end()
