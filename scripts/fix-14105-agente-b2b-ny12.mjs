// One-off: enrollment 14105 -> agente "B2B - NY12".
//   agent_origin = 'B2B'  +  seller_agent_id = users.alias 'NY12'
// Replica lo que hace el usecase editSellerAgent (setSellerAgent + logAudit),
// que es la via normal desde el panel FICO. Se hace por script porque ese
// endpoint exige cat_fico_status = checked y rol ADMIN/FICO/LIDER_FICO.
//
// Uso:  export PGPASSWORD='...'
//       node scripts/fix-14105-agente-b2b-ny12.mjs           # dry run
//       node scripts/fix-14105-agente-b2b-ny12.mjs --apply   # escribe
import { q, pool } from './db.mjs'

const ID = 14105
const ALIAS = 'NY12'
const ORIGIN = 'B2B'
const APPLY = process.argv.includes('--apply')

// El tunel SSH se cae seguido: reintenta la operacion completa.
async function conReintento (fn, intentos = 3) {
  for (let i = 1; i <= intentos; i++) {
    try { return await fn() } catch (e) {
      if (i === intentos) throw e
      console.log(`  … reintento ${i} tras "${e.message}"`)
      await new Promise(r => setTimeout(r, 1500 * i))
    }
  }
}

const fmtAgent = (alias, origin) => [origin, alias].filter(Boolean).join(' - ') || 'sin asesor'

async function main () {
  const { rows: [ag] } = await q(
    'SELECT user_id, alias, name FROM users WHERE UPPER(TRIM(alias)) = $1', [ALIAS])
  if (!ag) throw new Error(`No existe usuario con alias ${ALIAS}`)

  const { rows: [e] } = await q(`
    SELECT e.enrollment_id,
           e.parent_enrollment_id,
           e.agent_origin                              AS old_origin,
           e.seller_agent_id                           AS old_agent_id,
           u.alias                                     AS old_alias,
           cf.alias                                    AS fico_status,
           CONCAT(per.first_name, ' ', per.last_name)  AS alumno,
           pv.abbreviation                             AS programa,
           pe.global_code                              AS edicion,
           (SELECT COUNT(*) FROM enrollments h WHERE h.parent_enrollment_id = e.enrollment_id) AS hijos
      FROM enrollments e
      LEFT JOIN users u   ON u.user_id   = e.seller_agent_id
      LEFT JOIN catalog cf ON cf.catalog_id = e.cat_fico_status
      LEFT JOIN customers cust ON cust.customer_id = e.customer_id
      LEFT JOIN persons per    ON per.person_id    = cust.person_id
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN program_editions pe ON pe.edition_num_id     = e.program_edition_id
     WHERE e.enrollment_id = $1`, [ID])
  if (!e) throw new Error(`No existe el enrollment ${ID}`)

  console.log(`Asesor destino: ${ALIAS} -> user_id ${ag.user_id} (${ag.name})`)
  console.log('\nEstado actual:', {
    enrollment: e.enrollment_id,
    alumno: e.alumno,
    programa: `${e.programa || '?'} ${e.edicion || ''}`.trim(),
    fico_status: e.fico_status,
    padre: e.parent_enrollment_id,
    hijos: Number(e.hijos),
    agente: fmtAgent(e.old_alias, e.old_origin)
  })
  console.log(`Cambio: ${fmtAgent(e.old_alias, e.old_origin)}  ->  ${fmtAgent(ALIAS, ORIGIN)}`)

  if (Number(e.old_agent_id) === ag.user_id && (e.old_origin || null) === ORIGIN) {
    console.log('\nYa estaba asi. Nada que hacer.'); return
  }
  if (!APPLY) { console.log('\n(dry run) Corre con --apply para escribir.'); return }

  await q('UPDATE enrollments SET seller_agent_id = $1, agent_origin = $2 WHERE enrollment_id = $3',
    [ag.user_id, ORIGIN, ID])

  await q(`
    INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
    VALUES ($1, 'seller_agent_changed', NULL, $2, $3::jsonb, $4)`,
  [ID,
    'Correccion manual de datos (script scripts/fix-14105-agente-b2b-ny12.mjs)',
    JSON.stringify({ Asesor: { old: fmtAgent(e.old_alias, e.old_origin), new: fmtAgent(ALIAS, ORIGIN) } }),
    `Asesor: ${fmtAgent(e.old_alias, e.old_origin)} → ${fmtAgent(ALIAS, ORIGIN)}`])

  // El panel FICO lee la cabecera de la matview: sin refresh no se ve el cambio.
  await q('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')

  const { rows: [v] } = await q(`
    SELECT e.agent_origin, u.alias
      FROM enrollments e LEFT JOIN users u ON u.user_id = e.seller_agent_id
     WHERE e.enrollment_id = $1`, [ID])
  console.log('\nVerificado en BD:', fmtAgent(v.alias, v.agent_origin))
  console.log('Matview refrescada. Auditoria registrada.')
}

conReintento(main)
  .catch(e => { console.error('ERROR:', e.message); process.exitCode = 1 })
  .finally(() => pool.end())
