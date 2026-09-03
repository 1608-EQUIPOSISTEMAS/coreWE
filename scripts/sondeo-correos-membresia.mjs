// Sondeo de SOLO LECTURA: por que no salen los correos de bienvenida de membresia.
//
// El correo lo manda el step 'email' del job register_followup. Si un step
// anterior ('children' u 'odoo') falla, el job muere y el correo nunca se
// intenta: no queda rastro en email_logs, solo en fico_jobs.
//
//   node scripts/sondeo-correos-membresia.mjs           # BD del .env (pruebas)
//   node scripts/sondeo-correos-membresia.mjs --prod    # produccion via tunel
import fs from 'node:fs'
import 'dotenv/config'
import pg from 'pg'

const DIAS = 45

function connectionString () {
  if (!process.argv.includes('--prod')) return process.env.DATABASE_URL
  const linea = fs.readFileSync('.env.bak-produccion', 'utf8')
    .split('\n').find(l => l.startsWith('DATABASE_URL='))
  if (!linea) throw new Error('No hay DATABASE_URL en .env.bak-produccion')
  return linea.slice('DATABASE_URL='.length).trim()
}

const pool = new pg.Pool({ connectionString: connectionString(), max: 2, connectionTimeoutMillis: 10000 })
const q = (text, params) => pool.query(text, params)

console.log(`--- Correos enviados por tipo (${DIAS}d) ---`)
console.table((await q(`
  SELECT template_type, status, count(*) AS n, max(sent_at) AS ultimo
  FROM email_logs WHERE sent_at > now() - make_interval(days => $1)
  GROUP BY 1, 2 ORDER BY 1, 2`, [DIAS])).rows)

console.log(`\n--- Jobs que murieron antes del step 'email' (${DIAS}d) ---`)
console.table((await q(`
  SELECT job_id, job_type, enrollment_id, current_step AS murio_en, attempts,
         created_at, error_message
  FROM fico_jobs
  WHERE status = 'failed' AND created_at > now() - make_interval(days => $1)
  ORDER BY created_at DESC`, [DIAS])).rows)

console.log('\n--- Membresias con job fallido Y sin correo de bienvenida (pendientes de reenvio) ---')
console.table((await q(`
  SELECT j.enrollment_id, j.created_at::date AS venta, pv.abbreviation AS programa,
         e.odoo_user_id, j.error_message
  FROM fico_jobs j
  JOIN enrollments e ON e.enrollment_id = j.enrollment_id
  JOIN program_versions pv ON pv.program_version_id = e.program_version_id
  JOIN programs pr ON pr.program_id = pv.program_id
  WHERE j.status = 'failed' AND pr.is_membership = 'Y'
    AND NOT EXISTS (SELECT 1 FROM email_logs l
                    WHERE l.enrollment_id = j.enrollment_id AND l.template_type = 'membresia')
  ORDER BY j.created_at DESC`)).rows)

await pool.end()
