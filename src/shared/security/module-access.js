import { pool } from '../db/pool.js'

// Consulta de permisos rol↔módulo (tablas modules / rol_module_permission).
// Es la fuente dinámica que complementa los roles hardcodeados de auth.hooks:
// un gate pasa si el rol está en la lista fija O si la matriz otorga el módulo.
//
// Cache en memoria por código de módulo con TTL corto: los gates se evalúan en
// cada request y no queremos un round-trip a Postgres por cada una. Al guardar
// permisos desde el módulo config se llama clearModuleAccessCache() para que
// el cambio aplique de inmediato.

const TTL_MS = 60_000
const cache = new Map() // code -> { at: epoch ms, aliases: Set<string> }

async function grantedAliases (code, db = pool) {
  const hit = cache.get(code)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.aliases

  const { rows } = await db.query(
    `SELECT r.alias
     FROM public.rol_module_permission pm
     JOIN public.rol r ON r.rol_id = pm.rol_id
     JOIN public.modules m ON m.module_id = pm.module_id
     WHERE m.code = $1 AND pm.can_access AND m.active = 'Y'`,
    [code]
  )
  const aliases = new Set(rows.map(r => r.alias))
  cache.set(code, { at: Date.now(), aliases })
  return aliases
}

// ¿Alguno de los roles del usuario tiene acceso a alguno de los módulos?
// El código '*' significa "cualquier módulo" (gate de usuario interno).
export async function userHasModule (roles = [], moduleCodes = []) {
  if (!roles.length) return false
  if (roles.includes('ADMIN')) return true

  const codes = Array.isArray(moduleCodes) ? moduleCodes : [moduleCodes]
  if (codes.includes('*')) {
    const mods = await modulesForRoles(roles)
    return mods.length > 0
  }
  for (const code of codes) {
    const aliases = await grantedAliases(code)
    if (roles.some(role => aliases.has(role))) return true
  }
  return false
}

// Códigos de módulo accesibles para un conjunto de roles. ADMIN = todos.
// Lo consume el login (para guardarlos en el cliente) y /config/mymodules.
export async function modulesForRoles (roles = [], db = pool) {
  if (!roles.length) return []
  if (roles.includes('ADMIN')) {
    const { rows } = await db.query(
      "SELECT code FROM public.modules WHERE active = 'Y' ORDER BY sort_order"
    )
    return rows.map(r => r.code)
  }
  const { rows } = await db.query(
    `SELECT DISTINCT m.code, m.sort_order
     FROM public.rol_module_permission pm
     JOIN public.rol r ON r.rol_id = pm.rol_id
     JOIN public.modules m ON m.module_id = pm.module_id
     WHERE r.alias = ANY($1) AND pm.can_access AND m.active = 'Y'
     ORDER BY m.sort_order`,
    [roles]
  )
  return rows.map(r => r.code)
}

// Submódulos accesibles agrupados por código de módulo:
// { FICO: ['TOKENS', ...], PRODUCTO: [...] }. ADMIN = todos los activos.
// Lo consumen el login y /config/mymodules para el sidebar de dos niveles.
export async function submodulesForRoles (roles = [], db = pool) {
  if (!roles.length) return {}
  let rows
  if (roles.includes('ADMIN')) {
    ({ rows } = await db.query(
      `SELECT m.code AS module_code, s.code AS sub_code
       FROM public.submodules s
       JOIN public.modules m ON m.module_id = s.module_id
       WHERE s.active = 'Y' AND m.active = 'Y'
       ORDER BY m.sort_order, s.sort_order`
    ))
  } else {
    ({ rows } = await db.query(
      `SELECT DISTINCT m.code AS module_code, s.code AS sub_code, m.sort_order, s.sort_order AS sub_order
       FROM public.rol_submodule_permission ps
       JOIN public.rol r ON r.rol_id = ps.rol_id
       JOIN public.submodules s ON s.submodule_id = ps.submodule_id
       JOIN public.modules m ON m.module_id = s.module_id
       WHERE r.alias = ANY($1) AND ps.can_access AND s.active = 'Y' AND m.active = 'Y'
       ORDER BY m.sort_order, sub_order`,
      [roles]
    ))
  }
  const grouped = {}
  for (const row of rows) {
    (grouped[row.module_code] ??= []).push(row.sub_code)
  }
  return grouped
}

export function clearModuleAccessCache () {
  cache.clear()
}
