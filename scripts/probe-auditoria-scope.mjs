// Prueba de extremo a extremo del alcance por rol: ADMIN lo ve todo, cada
// LIDER_ solo a su área, y cualquier otro rol recibe 403.
import { listAuditLog } from '../src/modules/audit/audit.usecases.js'
import { pool } from '../src/shared/db/pool.js'

const casos = [['ADMIN'], ['LIDER_COMERCIAL'], ['LIDER_FICO'], ['LIDER_B2B'], ['COMERCIAL'], []]

for (const roles of casos) {
  const etiqueta = roles.join(',') || '(sin rol)'
  try {
    const r = await listAuditLog(roles, { page_size: 10 })
    const autores = [...new Set(r.rows.map(x => x.user_alias))]
    console.log(`${etiqueta.padEnd(18)} OK  filas=${String(r.rows.length).padEnd(3)} usuarios_filtrables=${String(r.users.length).padEnd(3)} alcance=${r.scope ? r.scope.join('/') : 'TODO'}`)
    console.log(`${''.padEnd(18)}     autores=${autores.join(', ') || '—'}`)
  } catch (e) {
    console.log(`${etiqueta.padEnd(18)} ${e.statusCode || '?'} ${e.message}`)
  }
}
await pool.end()
