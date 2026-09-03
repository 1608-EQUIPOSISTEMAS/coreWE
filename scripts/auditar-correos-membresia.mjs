// Auditoria de SOLO LECTURA: toda membresia padre y por que no le salio el
// correo de bienvenida. Clasifica la causa en vez de solo contar huecos.
//
//   node scripts/auditar-correos-membresia.mjs           # BD del .env (pruebas)
//   node scripts/auditar-correos-membresia.mjs --prod    # produccion via tunel
import fs from 'node:fs'
import 'dotenv/config'
import pg from 'pg'
import { STUDENT_EMAIL_SQL } from '../src/utils/student-contacts.sql.js'

function connectionString () {
  if (!process.argv.includes('--prod')) return process.env.DATABASE_URL
  const linea = fs.readFileSync('.env.bak-produccion', 'utf8')
    .split('\n').find(l => l.startsWith('DATABASE_URL='))
  if (!linea) throw new Error('No hay DATABASE_URL en .env.bak-produccion')
  return linea.slice('DATABASE_URL='.length).trim()
}

const pool = new pg.Pool({ connectionString: connectionString(), max: 2, connectionTimeoutMillis: 10000 })
const q = (text, params) => pool.query(text, params)

// Una membresia es el enrollment padre cuyo programa es is_membership.
// Mismo COALESCE que usa el envio real: si aca sale NULL, el correo no puede salir.
const MEMBRESIAS = `
  SELECT e.enrollment_id, e.registration_date::date AS venta,
         pv.abbreviation AS programa, e.odoo_user_id, e.odoo_email,
         e.membership_activation_date AS activacion,
         cs.description AS estado, e.notes,
         ${STUDENT_EMAIL_SQL} AS correo_alumno,
         EXISTS (SELECT 1 FROM email_logs el
                 WHERE el.enrollment_id = e.enrollment_id
                   AND el.template_type = 'membresia'
                   AND el.status = 'sent') AS correo_ok,
         (SELECT j.status || ' @ ' || coalesce(j.current_step, 'inicio')
          FROM fico_jobs j WHERE j.enrollment_id = e.enrollment_id
          ORDER BY j.created_at DESC LIMIT 1) AS ultimo_job,
         (SELECT j.error_message FROM fico_jobs j
          WHERE j.enrollment_id = e.enrollment_id AND j.status = 'failed'
          ORDER BY j.created_at DESC LIMIT 1) AS job_error
  FROM enrollments e
  JOIN program_versions pv ON pv.program_version_id = e.program_version_id
  JOIN programs pr ON pr.program_id = pv.program_id
  LEFT JOIN customers cust ON cust.customer_id = e.customer_id
  LEFT JOIN persons per ON per.person_id = cust.person_id
  LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
  LEFT JOIN catalog cs ON cs.catalog_id = e.cat_type_status
  WHERE pr.is_membership = 'Y' AND e.parent_enrollment_id IS NULL`

// Por que no salio el correo. El orden importa: la primera que aplica gana.
function clasificar (row) {
  if (row.correo_ok) return 'OK — correo enviado'
  if (!row.correo_alumno) return 'BLOQUEADO — el alumno no tiene correo registrado'
  if (row.job_error) return `JOB FALLIDO — ${row.job_error}`
  if (row.activacion && new Date(row.activacion) > new Date()) return 'DIFERIDO — activacion futura, el job lo mandara'
  if (/masiva FICO|importaci/i.test(row.notes || '')) return 'IMPORTADA — el import masivo no dispara el correo'
  if (!row.ultimo_job) return 'SIN JOB — nunca se encolo el register_followup'
  return `SIN CORREO Y SIN CAUSA CLARA (ultimo job: ${row.ultimo_job})`
}

const { rows } = await q(MEMBRESIAS + ' ORDER BY e.registration_date DESC')
console.log(`Membresias padre en la BD: ${rows.length}\n`)

const porCausa = new Map()
for (const row of rows) {
  const causa = clasificar(row)
  if (!porCausa.has(causa)) porCausa.set(causa, [])
  porCausa.get(causa).push(row)
}

console.log('--- Causas ---')
console.table([...porCausa].map(([causa, filas]) => ({
  causa,
  n: filas.length,
  desde: filas.at(-1).venta.toISOString().slice(0, 10),
  hasta: filas[0].venta.toISOString().slice(0, 10)
})).sort((a, b) => b.n - a.n))

for (const [causa, filas] of porCausa) {
  if (causa.startsWith('OK')) continue
  console.log(`\n--- ${causa} (${filas.length}) ---`)
  console.table(filas.slice(0, 40).map(f => ({
    enrollment_id: f.enrollment_id,
    venta: f.venta.toISOString().slice(0, 10),
    programa: f.programa,
    estado: f.estado,
    correo_alumno: f.correo_alumno || '(ninguno)',
    odoo_user_id: f.odoo_user_id,
    ultimo_job: f.ultimo_job
  })))
  if (filas.length > 40) console.log(`  ... y ${filas.length - 40} mas`)
}

await pool.end()
