// Sondeo del Seguimiento Docentes del Reporte Academico: imprime las primeras
// aulas del rango con su cronograma S1..Sn y que sesion trae auditoria.
//
//   node scripts/probe-teacher-followup.mjs [YYYY-MM-DD] [YYYY-MM-DD]
//
// Corre contra la BD que diga Backend/.env (por defecto, la local de pruebas).
import 'dotenv/config'
import { editionTeacherFollowup } from '../src/modules/edition/edition.usecases.js'

const [dateStart = '2026-06-01', dateEnd = '2026-06-30'] = process.argv.slice(2)

const { editions } = await editionTeacherFollowup({ date_start: dateStart, date_end: dateEnd })
console.log(`Rango ${dateStart} → ${dateEnd}: ${editions.length} aulas`)

for (const e of editions.slice(0, 8)) {
  const audited = e.sessions.filter((s) => s.ai_20 != null || s.manual_20 != null).length
  console.log(`\n${e.abbreviation} (${e.specific_code}) · ${e.instructor} · inicia ${e.start_date}`)
  console.log(`  auditadas ${audited}/${e.sessions.length}`)
  console.log('  ' + e.sessions.map((s) =>
    `S${s.session_number} ${s.date}${s.status ? `[${s.status}]` : ''}` +
    `${s.ai_20 != null || s.manual_20 != null ? ` ia=${s.ai_20 ?? '-'} man=${s.manual_20 ?? '-'}` : ''}`
  ).join(' | '))
}
process.exit(0)
