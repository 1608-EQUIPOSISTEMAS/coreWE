// Compara la formula VIEJA de INICIAL (monto de la cuota, cobrada o no) contra
// la NUEVA (base caja, como INGRESO/SALDO/C1..C5) sobre EXACTAMENTE el conjunto
// de filas que llega a "0. Ventas Sistemas". Sirve para medir el blast radius
// antes de tocar la query. Sondeo, no modifica nada.
import 'dotenv/config'
import {
  EXCLUDE_HELD, EXCLUDE_IMPORTED, SYNC_FROM, PARENT_OR_CC_DESTINATION
} from '../src/modules/integration/integration.repository.js'
import { q, pool } from './db.mjs'

const { rows } = await q(`
WITH approved AS (
  SELECT e.enrollment_id
    FROM public.enrollments e
    JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
   WHERE cf.alias = 'we_enrollment_status_checked'
     AND e.active = 'Y'
     ${PARENT_OR_CC_DESTINATION}
     ${EXCLUDE_IMPORTED}
     ${EXCLUDE_HELD}
     ${SYNC_FROM}
)
SELECT e.enrollment_id, c_plan.alias AS plan, e.total_amount,
       CASE WHEN e.total_amount = 0 THEN 0
            WHEN c_plan.alias = 'we_payment_way_single'       THEN COALESCE(pi_pt.amount, e.total_amount)
            WHEN c_plan.alias = 'we_payment_way_installments' THEN COALESCE(pi_res.amount, 0)
            ELSE 0 END AS inicial_vieja,
       CASE WHEN e.total_amount = 0 THEN 0
            WHEN c_plan.alias = 'we_payment_way_single'       THEN COALESCE(pay.total_paid, 0)
            WHEN c_plan.alias = 'we_payment_way_installments' THEN CASE WHEN pi_res.pagada THEN pi_res.amount ELSE 0 END
            ELSE 0 END AS inicial_nueva
  FROM public.enrollments e
  JOIN approved a ON a.enrollment_id = e.enrollment_id
  LEFT JOIN public."catalog" c_plan ON c_plan.catalog_id = e.cat_payment_plan
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(pi.amount), 0) AS total_paid
      FROM public.payment_installments pi
      JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
     WHERE pi.enrollment_id = e.enrollment_id
       AND cs.alias IN ('we_inst_paid', 'we_payment_status_paid')) pay ON TRUE
  LEFT JOIN LATERAL (
    SELECT amount FROM public.payment_installments
     WHERE enrollment_id = e.enrollment_id AND installment_number = 1 LIMIT 1) pi_pt ON TRUE
  LEFT JOIN LATERAL (
    SELECT pi.amount, cs.alias IN ('we_inst_paid','we_payment_status_paid') AS pagada
      FROM public.payment_installments pi
      JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
     WHERE pi.enrollment_id = e.enrollment_id AND pi.installment_number = 0 LIMIT 1) pi_res ON TRUE`)

const cambian = rows.filter(r => Number(r.inicial_vieja) !== Number(r.inicial_nueva))
console.log('filas evaluadas :', rows.length)
console.log('filas que cambian:', cambian.length)
console.log('delta neto      : S/', cambian.reduce((a, r) => a + Number(r.inicial_nueva) - Number(r.inicial_vieja), 0).toFixed(2))
console.table(cambian.slice(0, 12))
await pool.end()
