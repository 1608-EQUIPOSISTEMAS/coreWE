// La opcion tiene que existir en la matriz de Roles y Permisos, no solo en el
// _nav / router (sin fila en BD solo la ven los roles hardcodeados).
import { q, pool } from './db.mjs'
const { rows } = await q(`
  SELECT s.code, s.name, s.active, m.code AS modulo,
         (SELECT COUNT(*)::int FROM public.rol_submodule_permission rs
           WHERE rs.submodule_id = s.submodule_id AND rs.can_access = true) AS roles_con_permiso
    FROM public.submodules s
    JOIN public.modules m ON m.module_id = s.module_id
   WHERE s.code = 'REPROGRAMACIONES'`)
console.log(rows.length ? rows : 'FALTA: correr node scripts/sync-modules-roles.mjs')
await pool.end()
