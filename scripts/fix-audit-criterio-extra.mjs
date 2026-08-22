// One-off 21/08/26: la IA agregó un criterio #10 ("Criterio extra") en la
// auditoría de una sesión, arrastrando el promedio hacia abajo. Este script
// borra cualquier criterio con id > 9 del ai_report y recalcula
// metricas_rapidas.puntuacion_global como promedio simple de los 9 reales.
// Uso: node scripts/fix-audit-criterio-extra.mjs [--apply] [--edition 48] [--session 3]
import pg from 'pg'

const argv = process.argv.slice(2)
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1] }
const APPLY = argv.includes('--apply')
const CONN = process.env.PGURL

const db = new pg.Client({ connectionString: CONN })
await db.connect()

const where = []
const params = []
if (flag('edition')) { params.push(Number(flag('edition'))); where.push(`program_edition_id = $${params.length}`) }
if (flag('session')) { params.push(Number(flag('session'))); where.push(`session_number = $${params.length}`) }

const { rows } = await db.query(`
  SELECT program_edition_id, session_number, ai_report
    FROM public.classroom_audit_rubric
   WHERE ai_report IS NOT NULL
     AND jsonb_array_length(ai_report->'criterios') > 9
     ${where.length ? 'AND ' + where.join(' AND ') : ''}
   ORDER BY program_edition_id, session_number`, params)

console.log(`filas con criterios extra: ${rows.length}`)
for (const r of rows) {
  const report = r.ai_report
  const validos = report.criterios.filter(c => Number(c.id) <= 9)
  const scores = validos.map(c => Number(c.score)).filter(Number.isFinite)
  const global = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
  const antes = report.metricas_rapidas?.puntuacion_global
  console.log(`  E${r.program_edition_id} S${r.session_number}: ${report.criterios.length}→${validos.length} criterios, global ${antes} → ${global}`)
  report.criterios.filter(c => Number(c.id) > 9).forEach(c => console.log(`    borra #${c.id} "${c.nombre}" score ${c.score}`))
  if (!APPLY) continue
  report.criterios = validos
  report.metricas_rapidas = { ...report.metricas_rapidas, puntuacion_global: global }
  await db.query(
    `UPDATE public.classroom_audit_rubric SET ai_report = $1::jsonb, updated_at = NOW()
      WHERE program_edition_id = $2 AND session_number = $3`,
    [JSON.stringify(report), r.program_edition_id, r.session_number])
}
console.log(APPLY ? 'APLICADO' : 'dry-run (agregá --apply)')
await db.end()
