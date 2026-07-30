// Reenvia el correo de confirmacion del destino de CC 14709 a la alumna real,
// usando el MISMO flujo que dispara courseChange (sendConfirmationEmail).
// Guardas: aborta si el destinatario o el vinculo Odoo no son los esperados.
import fs from 'node:fs'
const envTxt = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const u = new URL(envTxt.match(/^DATABASE_URL=(.+)$/m)[1].trim())
u.hostname = '127.0.0.1'; u.port = '55432'; u.search = ''
process.env.DATABASE_URL = u.toString()
process.env.DATABASE_SSL = 'false'

const EID = 14709
const ESPERADO = 'carlotaazucenaflores@gmail.com'

const { pool } = await import('../src/config/db.js')
const { sendConfirmationEmail, previewConfirmationEmail } = await import('../src/modules/fico/email-confirmation/email-confirmation.usecases.js')

try {
  // --- Guardas previas -----------------------------------------------------
  const e = (await pool.query(
    'select customer_id, odoo_user_id, odoo_email, cat_type_status, ' +
    '(select count(*) from enrollments h where h.parent_enrollment_id=$1) hijos ' +
    'from enrollments where enrollment_id=$1', [EID])).rows[0]
  console.log('estado previo:', e)
  if (e.customer_id !== 18331) throw new Error('El enrollment no cuelga del alumno real (18331)')
  if (!e.odoo_user_id) throw new Error('Sin odoo_user_id: el correo saldria con credenciales ficticias')
  if (Number(e.hijos) !== 3) throw new Error('Se esperaban 3 hijos, hay ' + e.hijos)

  const prev = await previewConfirmationEmail({ enrollmentId: EID })
  console.log('destinatario que resuelve el flujo:', prev.to)
  console.log('asunto:', prev.subject)
  if (prev.to !== ESPERADO) throw new Error('El destinatario NO es ' + ESPERADO + ' sino ' + prev.to)

  // --- Envio real ----------------------------------------------------------
  console.log('\n>>> enviando...')
  const res = await sendConfirmationEmail({ enrollmentId: EID })
  console.log('resultado crudo:', JSON.stringify(res))
  if (!res?.success) throw new Error('ENVIO FALLIDO: ' + (res?.error || 'sin detalle'))

  const logs = await pool.query(
    'select email_log_id, to_email, subject, status, message_id, sent_at from email_logs where enrollment_id=$1 order by email_log_id desc limit 3', [EID])
  console.log('\n=== email_logs (ultimos) ===')
  console.table(logs.rows)
  const aud = await pool.query(
    "select audit_id, action, details, performed_at from enrollment_audit_log where enrollment_id=$1 and action in ('email_sent','email_failed') order by audit_id desc limit 3", [EID])
  console.log('=== audit de correo (ultimos) ===')
  console.table(aud.rows)
  console.log('\nENVIO OK')
} catch (err) {
  console.error('\n!!! ERROR:', err.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
