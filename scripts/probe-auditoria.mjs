// Sondeo de la infraestructura que necesita el módulo de Auditoría:
// tabla audit_logs, triggers fn_audit_changes y la matriz de Roles y Permisos.
import { q, pool } from './db.mjs'
import { AUDITED_TABLES } from '../src/modules/audit/audit.entity.js'

const seccion = (t) => console.log(`\n=== ${t}`)

seccion('¿existe audit_logs?')
const { rows: cols } = await q(`
  SELECT column_name, data_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='audit_logs' ORDER BY ordinal_position`)
console.log(cols.length ? cols.map(c => `${c.column_name}:${c.data_type}`).join(', ') : '>>> NO EXISTE <<<')

if (cols.length) {
  seccion('volumen y acciones')
  console.table((await q(`SELECT action, count(*)::int n FROM audit_logs GROUP BY action ORDER BY n DESC`)).rows)
  seccion('tablas auditadas realmente presentes')
  console.table((await q(`SELECT table_name, count(*)::int n, max(created_at) ultimo FROM audit_logs GROUP BY table_name ORDER BY n DESC LIMIT 20`)).rows)
}

seccion('triggers de auditoría instalados')
console.table((await q(`
  SELECT event_object_table tabla, trigger_name FROM information_schema.triggers
   WHERE trigger_schema='public' AND action_statement ILIKE '%audit%' ORDER BY 1`)).rows)

seccion('submódulo AUDITORIA en la matriz de Roles')
console.table((await q(`
  SELECT s.submodule_id, s.code, s.name, s.active, m.code modulo
    FROM submodules s JOIN modules m ON m.module_id=s.module_id
   WHERE s.code='AUDITORIA'`)).rows)

seccion('roles LIDER_ existentes')
console.table((await q(`SELECT * FROM rol WHERE alias LIKE 'LIDER%' ORDER BY alias`)).rows)

seccion('deriva: tablas en audit_logs que el catalogo no conoce')
const { rows: presentes } = await q('SELECT DISTINCT table_name FROM audit_logs')
const faltan = presentes.map(r => r.table_name).filter(t => !AUDITED_TABLES[t])
console.log(faltan.length
  ? `>>> AGREGAR a AUDITED_TABLES en audit.entity.js: ${faltan.join(', ')} <<<`
  : 'sin deriva: el catalogo cubre todo lo que hay en la bitacora')

await pool.end()
