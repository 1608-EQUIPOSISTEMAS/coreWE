// Sondeo: por que Fundacion > Objetivos parte Comercial en VIP 1 / VIRTUAL 1
// cuando las dos ventas del congreso son VIP.
import { q, pool } from './db.mjs'

const EDICION = process.argv[2] ? Number(process.argv[2]) : null

const { rows } = await q(`
  SELECT e.enrollment_id, e.program_edition_id, u.alias AS asesor,
         e.cat_event_category, c.alias AS cat_alias, c.description AS cat_desc,
         e.event_seat, e.agent_origin, e.parent_enrollment_id,
         st.alias AS estado,
         l.lead_id, l.cat_type_strategy, chp.description AS canal_pago
    FROM public.enrollments e
    LEFT JOIN public.users u ON u.user_id = e.seller_agent_id
    LEFT JOIN public.catalog c ON c.catalog_id = e.cat_event_category
    LEFT JOIN public.catalog st ON st.catalog_id = e.cat_type_status
    LEFT JOIN LATERAL (SELECT l2.lead_id, l2.cat_type_strategy
                         FROM public.leads l2 WHERE l2.enrollment_id = e.enrollment_id
                        ORDER BY l2.lead_id LIMIT 1) l ON true
    LEFT JOIN public.catalog chp ON chp.catalog_id = e.cat_payment_channel
   WHERE ($1::int IS NULL OR e.program_edition_id = $1)
     AND e.cat_event_category IS NOT NULL
     AND e.active = 'Y'
   ORDER BY e.program_edition_id, e.enrollment_id
`, [EDICION])

console.table(rows)
await pool.end()
