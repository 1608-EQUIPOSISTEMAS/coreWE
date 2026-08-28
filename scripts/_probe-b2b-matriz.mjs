// ponytail: sondeo de solo lectura de la matriz de permisos del modulo B2B (BD local).
import { q } from './db.mjs'

const mods = await q(
  `SELECT m.module_id, m.code, m.name FROM modules m WHERE m.code = 'B2B'`
)
console.log('modulo B2B:', mods.rows)

const subs = await q(
  `SELECT s.submodule_id, s.code, s.name, s.active
     FROM submodules s JOIN modules m ON m.module_id = s.module_id
    WHERE m.code = 'B2B' ORDER BY s.submodule_id`
)
console.log('submodulos B2B:', subs.rows)

const grants = await q(
  `SELECT r.alias, m.code AS module
     FROM rol_module_permission p
     JOIN rol r ON r.rol_id = p.rol_id
     JOIN modules m ON m.module_id = p.module_id
    WHERE m.code = 'B2B' ORDER BY r.alias`
)
console.log('roles con modulo B2B:', grants.rows)

const subGrants = await q(
  `SELECT r.alias, s.code AS submodule
     FROM rol_submodule_permission p
     JOIN rol r ON r.rol_id = p.rol_id
     JOIN submodules s ON s.submodule_id = p.submodule_id
     JOIN modules m ON m.module_id = s.module_id
    WHERE m.code = 'B2B' ORDER BY r.alias, s.code`
)
console.log('roles con submodulos B2B:', subGrants.rows)
process.exit(0)
