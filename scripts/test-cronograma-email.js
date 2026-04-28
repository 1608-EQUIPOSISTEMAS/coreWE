import 'dotenv/config'
import { pool } from '../src/config/db.js'
import { generateCronogramaPdfByIds } from '../src/services/pdf.service.js'
import { sendEmail } from '../src/config/zeptomail.js'

const TO_EMAIL = 'fercarbajalcarbajal@gmail.com'
const PROGRAM_SEARCH = '%PROC%MEJORA%'
const EDITION_START_DATE = '2026-05-09'

async function findTarget () {
  const { rows } = await pool.query(`
    SELECT pv.program_version_id, pv.abbreviation, pv.version_code,
           pe.edition_num_id, pe.global_code, pe.start_date
    FROM program_versions pv
    JOIN program_editions pe ON pe.program_version_id = pv.program_version_id
    WHERE pv.abbreviation ILIKE $1
      AND pe.start_date = $2
      AND pv.active = 'Y'
      AND pe.active = 'Y'
    ORDER BY pv.program_version_id DESC
    LIMIT 1
  `, [PROGRAM_SEARCH, EDITION_START_DATE])

  if (rows.length) return rows[0]

  console.log('[test] No match exacto. Buscando programas parecidos...')
  const { rows: similar } = await pool.query(`
    SELECT pv.program_version_id, pv.abbreviation, pv.version_code
    FROM program_versions pv
    WHERE pv.abbreviation ILIKE $1 AND pv.active = 'Y'
    ORDER BY pv.program_version_id DESC
    LIMIT 10
  `, [PROGRAM_SEARCH])
  console.log('[test] Programas con "PROC...MEJORA":')
  for (const p of similar) {
    const { rows: eds } = await pool.query(`
      SELECT edition_num_id, global_code, start_date FROM program_editions
      WHERE program_version_id = $1 AND active = 'Y'
      ORDER BY start_date DESC LIMIT 5
    `, [p.program_version_id])
    console.log(`  pv=${p.program_version_id} [${p.version_code || '-'}] ${p.abbreviation}`)
    for (const e of eds) {
      const d = e.start_date ? new Date(e.start_date).toISOString().slice(0, 10) : '-'
      console.log(`    ed=${e.edition_num_id} code=${e.global_code || '-'} start=${d}`)
    }
  }
  return null
}

async function main () {
  console.log('[test] Buscando DIP PROC Y MEJORA V4 edicion 09/05/2026...')
  const target = await findTarget()
  if (!target) {
    console.error('[test] NO se encontro. Revisa la lista de candidatos arriba y ajusta el script.')
    process.exit(1)
  }

  console.log(`[test] Encontrado: pv=${target.program_version_id} (${target.abbreviation}) | edicion=${target.edition_num_id} (${target.global_code})`)
  console.log('[test] Generando PDF con puppeteer (tomar 3-8s)...')

  const pdfBuffer = await generateCronogramaPdfByIds({
    programVersionId: target.program_version_id,
    programEditionId: target.edition_num_id
  })
  console.log(`[test] PDF generado: ${pdfBuffer.length} bytes`)

  console.log(`[test] Enviando email a ${TO_EMAIL}...`)
  const subject = `[PRUEBA] Cronograma ${target.abbreviation} - ${target.global_code || ''}`
  const htmlBody = `
    <div style="font-family: Tahoma, sans-serif; padding: 20px;">
      <h2 style="color: #1c4587;">Prueba de cronograma PDF</h2>
      <p>Este es un correo de prueba del nuevo PDF de cronograma acad&eacute;mico.</p>
      <p><strong>Programa:</strong> ${target.abbreviation}<br>
      <strong>Edici&oacute;n:</strong> ${target.global_code || '-'}<br>
      <strong>Fecha inicio:</strong> ${target.start_date ? new Date(target.start_date).toLocaleDateString('es-PE') : '-'}</p>
      <p>Encuentra el cronograma adjunto.</p>
      <hr>
      <p style="color: #666; font-size: 11px;">Correo generado por script de prueba. No requiere respuesta.</p>
    </div>
  `
  const result = await sendEmail({
    to: TO_EMAIL,
    subject,
    htmlBody,
    attachments: [{
      filename: `Cronograma-${target.abbreviation.replace(/[^a-zA-Z0-9]+/g, '-')}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf'
    }]
  })

  if (result.success) {
    console.log(`[test] ✓ Email enviado. messageId: ${result.messageId}`)
  } else {
    console.error(`[test] ✗ Email fallo: ${result.error}`)
    process.exit(1)
  }
}

main()
  .then(() => { pool.end(); process.exit(0) })
  .catch(err => {
    console.error('[test] Error fatal:', err.message)
    console.error(err.stack)
    pool.end().catch(() => {})
    process.exit(1)
  })
