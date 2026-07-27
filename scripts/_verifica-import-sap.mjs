// Verificación de la importación SAP HANA del 2026-07-24: por cada padre
// importado, sus cuotas, sus hijos de paquete y si el dinero cierra.
import { q, pool } from './db.mjs'

const IDS = [14362, 14366, 14367, 14369, 14371, 14375, 14379, 14383, 14387, 14391, 14397, 14400, 14404]

const { rows } = await q(`
  SELECT e.enrollment_id AS id, p.document_number AS dni,
         p.first_name || ' ' || p.last_name AS nombre,
         pe.global_code AS ed, e.list_price, e.total_amount, e.notes,
         e.membership_program_id AS tier,
         (SELECT count(*) FROM public.enrollments h WHERE h.parent_enrollment_id = e.enrollment_id) AS hijos,
         (SELECT count(*) FROM public.payment_installments pi WHERE pi.enrollment_id = e.enrollment_id) AS cuotas,
         (SELECT COALESCE(sum(pi.amount), 0) FROM public.payment_installments pi WHERE pi.enrollment_id = e.enrollment_id) AS suma_cuotas
    FROM public.enrollments e
    JOIN public.customers c ON c.customer_id = e.customer_id
    JOIN public.persons p ON p.person_id = c.person_id
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
   WHERE e.enrollment_id = ANY($1)
   ORDER BY e.enrollment_id`, [IDS])

for (const r of rows) {
  const cierra = Math.abs(Number(r.suma_cuotas) - Number(r.total_amount)) < 0.01 ? 'ok' : `!= total ${r.total_amount}`
  console.log(`${r.id} | ${r.dni} | ${r.nombre} | ED ${r.ed} | total ${r.total_amount} | lista ${r.list_price} | hijos ${r.hijos} | cuotas ${r.cuotas} suma ${r.suma_cuotas} (${cierra}) | tier ${r.tier ?? '-'}`)
}

// Detalle de cuotas de los que tienen plan.
const { rows: cuotas } = await q(`
  SELECT pi.enrollment_id AS id, pi.installment_number AS n, pi.amount, pi.due_date, pi.cat_status
    FROM public.payment_installments pi
   WHERE pi.enrollment_id = ANY($1)
   ORDER BY pi.enrollment_id, pi.installment_number`, [IDS])
console.log('\ncuotas creadas:')
for (const c of cuotas) {
  console.log(`  ${c.id} #${c.n} ${c.amount} vence ${String(c.due_date).slice(0, 15)} estado ${c.cat_status}`)
}

await pool.end()
