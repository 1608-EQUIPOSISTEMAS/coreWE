// Backfill del mismo criterio que TokenRepository.stampB2bOriginFromAdvisor: una
// venta cerrada por token de un asesor de convenios se marca agent_origin='B2B'.
// El fix de codigo solo alcanza a las confirmaciones futuras; esto arregla las ya
// registradas (18534). Idempotente: solo rellena el hueco, nunca pisa un origen.
//
//   DATABASE_URL='...' node scripts/marcar-b2b-ventas-por-token.mjs --aplicar
import { q, pool } from './db.mjs'

const APLICAR = process.argv.includes('--aplicar')

const CANDIDATOS = `
  SELECT DISTINCT e.enrollment_id, u_pt.alias AS pidio_token
    FROM enrollments e
    JOIN LATERAL (SELECT pt.* FROM payment_tokens pt
                   WHERE pt.enrollment_id = e.enrollment_id
                   ORDER BY pt.token_id LIMIT 1) pt ON TRUE
    JOIN users u_pt ON u_pt.user_id = COALESCE(pt.requested_by, pt.created_by)
    JOIN user_roles ur ON ur.user_id = u_pt.user_id
    JOIN rol r ON r.rol_id = ur.rol_id AND r.alias IN ('B2B', 'LIDER_B2B')
   WHERE e.active = 'Y' AND e.agent_origin IS NULL`

const { rows } = await q(CANDIDATOS)
console.log(`${rows.length} venta(s) por marcar como B2B:`)
console.table(rows)

if (!APLICAR) {
  console.log('\nEnsayo. Corre con --aplicar para guardar.')
} else if (rows.length > 0) {
  const { rowCount } = await q(
    `UPDATE enrollments SET agent_origin = 'B2B'
      WHERE enrollment_id = ANY($1::int[]) AND agent_origin IS NULL`,
    [rows.map(r => r.enrollment_id)]
  )
  console.log(`\nMarcadas: ${rowCount}`)
}

await pool.end()
