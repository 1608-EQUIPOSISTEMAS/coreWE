// Prueba de humo de las acciones del menú de usuario en la Auditoría:
// escribe una de cada código y comprueba que la bitácora las devuelva con su
// etiqueta. Corre contra la BD que diga .env (por defecto, la local de pruebas).
//
//   node scripts/probe-audit-system-actions.mjs [--limpiar]
//
// Con --limpiar borra las filas que acaba de crear; sin la bandera se quedan
// para poder mirarlas en /configuracion/auditoria.
import 'dotenv/config'
import { pool } from '../src/shared/db/pool.js'
import { SYSTEM_ACTIONS } from '../src/modules/audit/audit.entity.js'
import { recordSystemAction, listAuditLog } from '../src/modules/audit/audit.usecases.js'

const USER_ID = Number(process.argv[2]) || 1

for (const action of SYSTEM_ACTIONS) {
  await recordSystemAction(USER_ID, action)
}

// Una acción inventada no debe llegar a la bitácora ni reventar.
await recordSystemAction(USER_ID, 'DROP_TABLE')

const { rows } = await listAuditLog(['ADMIN'], { table_name: 'system_actions', page_size: 10 })
console.table(rows.map(({ created_at, user_alias, action, table_label, record_id }) =>
  ({ created_at, user_alias, action, table_label, record_id })))

const escritas = rows.filter(r => SYSTEM_ACTIONS.includes(r.action)).length
console.log(escritas >= SYSTEM_ACTIONS.length ? 'OK: la bitacora ve las acciones de menu' : 'FALLO: faltan acciones')
console.log(rows.some(r => r.action === 'DROP_TABLE') ? 'FALLO: entro una accion fuera de la lista blanca' : 'OK: lista blanca respetada')

if (process.argv.includes('--limpiar')) {
  const { rowCount } = await pool.query(
    "DELETE FROM public.audit_logs WHERE table_name = 'system_actions' AND user_id = $1", [USER_ID])
  console.log(`Limpieza: ${rowCount} filas borradas`)
}

await pool.end()
