// Antes/despues de la columna ASESOR para las ventas B2B que salian con el
// descartar como asesor a los operadores FICO (ELFI/RAFI/MECA/MAFI).
//   node scripts/probe-asesor-antes-despues.mjs [--prod]
import fs from 'fs'
if (process.argv.includes('--prod')) {
  process.env.DATABASE_URL = fs.readFileSync('.env.bak-produccion', 'utf8').match(/postgresql:\/\/\S+/)[0]
}
const { pool } = await import('./db.mjs')
const { NOT_FICO_OPERATOR } = await import('../src/modules/integration/integration.repository.js')

const asesor = (alias) => `CASE
  WHEN e.agent_origin IS NOT NULL AND ${alias} IS NOT NULL THEN e.agent_origin || ' - ' || ${alias}
  ELSE COALESCE(${alias}, e.agent_origin, 'S/A') END`

const { rows } = await pool.query(`
  SELECT e.enrollment_id,
         ${asesor("COALESCE(tok_viejo.alias, u_viejo.alias)")} AS antes,
         ${asesor("COALESCE(tok_nuevo.alias, u_nuevo.alias)")} AS despues
    FROM enrollments e
    -- cascada original: cualquier usuario sirve como asesor
    LEFT JOIN users u_viejo ON u_viejo.user_id = e.seller_agent_id
    LEFT JOIN LATERAL (
      SELECT up.alias FROM payment_tokens pt
        LEFT JOIN users up ON up.user_id = COALESCE(pt.requested_by, pt.created_by)
       WHERE pt.enrollment_id = e.enrollment_id ORDER BY pt.token_id ASC LIMIT 1
    ) tok_viejo ON TRUE
    -- cascada nueva: el operador FICO no cuenta como asesor
    LEFT JOIN users u_nuevo ON u_nuevo.user_id = e.seller_agent_id
                           AND ${NOT_FICO_OPERATOR('u_nuevo')}
    LEFT JOIN LATERAL (
      SELECT up.alias FROM payment_tokens pt
        LEFT JOIN users up ON up.user_id = COALESCE(pt.requested_by, pt.created_by)
                          AND ${NOT_FICO_OPERATOR('up')}
       WHERE pt.enrollment_id = e.enrollment_id ORDER BY pt.token_id ASC LIMIT 1
    ) tok_nuevo ON TRUE
   WHERE e.active = 'Y'
     AND (e.agent_origin ILIKE '%b2b%' OR e.b2b_contract_id IS NOT NULL)
   ORDER BY e.enrollment_id
`)

const cambian = rows.filter(r => r.antes !== r.despues)
console.log(`ventas B2B revisadas: ${rows.length} — cambian: ${cambian.length}`)
for (const r of cambian) {
  console.log(`  #${String(r.enrollment_id).padEnd(6)} "${r.antes}" -> "${r.despues}"`)
}
await pool.end()
