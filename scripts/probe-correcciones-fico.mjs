// Solo lectura. Mide cuanto retrabajo generan las correcciones de montos/estados
// pedidas por FICO, leyendo la bitacora enrollment_audit_log.
// Uso (desde Backend/, contra produccion):
//   DATABASE_URL="<tunel 55432>" node scripts/probe-correcciones-fico.mjs
import { q } from './db.mjs'

// Correccion = lo que se hizo a mano por script (performed_by NULL) o por la
// accion de edicion de monto de cuota que ya existe en la UI.
const ES_CORRECCION = `(
  (action = 'edited' AND performed_by IS NULL)
  OR action IN ('installment_amount_edited', 'financial_data_fixed', 'financial_correction',
                'discount_amount_corrected', 'payment_deleted', 'status_corrected')
)`

const porMes = await q(`
  SELECT to_char(date_trunc('month', performed_at), 'YYYY-MM') AS mes,
         COUNT(*) FILTER (WHERE action = 'approved')                              AS aprobadas,
         COUNT(DISTINCT enrollment_id) FILTER (WHERE ${ES_CORRECCION})            AS ventas_corregidas,
         COUNT(*) FILTER (WHERE action = 'installment_amount_edited')             AS monto_cuota_ui,
         COUNT(*) FILTER (WHERE action = 'edited' AND performed_by IS NULL)       AS script_manual,
         COUNT(*) FILTER (WHERE changes ? 'Pago inicial')                         AS inicial
    FROM enrollment_audit_log
   WHERE performed_at >= '2026-01-01'
   GROUP BY 1 ORDER BY 1`)
console.table(porMes.rows)

const quienEdita = await q(`
  SELECT u.name, COUNT(*) AS n
    FROM enrollment_audit_log a LEFT JOIN users u ON u.user_id = a.performed_by
   WHERE a.action = 'installment_amount_edited'
   GROUP BY 1 ORDER BY 2 DESC LIMIT 8`)
console.table(quienEdita.rows)

const muestra = await q(`
  SELECT enrollment_id, performed_at::date AS dia, changes::text, left(details, 120) AS details
    FROM enrollment_audit_log
   WHERE action = 'installment_amount_edited'
   ORDER BY performed_at DESC LIMIT 5`)
console.table(muestra.rows)

// Quien aprobo las ventas que despues hubo que corregir: concentrado en pocas
// personas es capacitacion; repartido es el flujo.
const aprobadores = await q(`
  SELECT u.name, COUNT(*) AS aprobo_y_luego_se_corrigio
    FROM enrollment_audit_log a LEFT JOIN users u ON u.user_id = a.performed_by
   WHERE a.action = 'approved'
     AND a.enrollment_id IN (SELECT enrollment_id FROM enrollment_audit_log WHERE ${ES_CORRECCION})
   GROUP BY 1 ORDER BY 2 DESC LIMIT 8`)
console.table(aprobadores.rows)
process.exit(0)
