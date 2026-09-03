// Sonda de la bitácora: imprime cómo se ve una página de auditoría YA traducida
// (etiqueta en español + valores resueltos), tal cual la recibe la vista.
//
//   node scripts/probe-audit-fields.mjs [cantidad]
import 'dotenv/config'
import { listAuditLog } from '../src/modules/audit/audit.usecases.js'

const cantidad = Number(process.argv[2] || 25)
const { rows } = await listAuditLog(['ADMIN'], { page: 1, page_size: cantidad })

for (const row of rows) {
  const cambios = row.changes.length
    ? row.changes.map(c => `${c.label}: ${c.old ?? 'vacío'} -> ${c.new ?? 'vacío'}`).join(' | ')
    : '(sin diff)'
  console.log(`${row.created_at}  ${row.user_alias}  ${row.action}  ${row.table_label} #${row.record_id}`)
  console.log(`   ${cambios.slice(0, 220)}`)
}

process.exit(0)
