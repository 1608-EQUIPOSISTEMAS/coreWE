// One-off: poner canal B2B (agent_origin) al enrollment 7634 y sus 5 hijos.
// El canal vive en enrollments.agent_origin; el asesor (seller_agent_id) no cambia.
// Uso: DATABASE_URL=<prod> node scripts/enr-7634-agente.mjs [--aplicar]
import { q, pool } from './db.mjs'

const ID = 7634
const aplicar = process.argv.includes('--aplicar')

const ver = () => q(`
  SELECT e.enrollment_id, e.parent_enrollment_id, e.agent_origin, e.seller_agent_id,
         u.alias AS seller_alias, e.cat_fico_status, e.active
    FROM public.enrollments e
    LEFT JOIN public.users u ON u.user_id = e.seller_agent_id
   WHERE e.enrollment_id = $1 OR e.parent_enrollment_id = $1
   ORDER BY e.parent_enrollment_id NULLS FIRST, e.enrollment_id`, [ID])

console.table((await ver()).rows)

if (aplicar) {
  await q(`UPDATE public.enrollments SET agent_origin = 'B2B'
            WHERE enrollment_id = $1 OR parent_enrollment_id = $1`, [ID])
  console.log('-- despues --')
  console.table((await ver()).rows)
}
await pool.end()
