import { pool } from '../config/db.js'

// Cache en memoria del proceso. Los catalog_id son inmutables a menos que se
// modifique manualmente la tabla catalog (caso raro). Cache se reinicia con
// reinicio del backend.
const _idByAlias = new Map()

/**
 * Resuelve el catalog_id de un alias del catalogo, con cache.
 * @param {string} alias - alias del catalogo (ver ALIAS de catalog-aliases.js)
 * @returns {Promise<number|null>} catalog_id o null si no existe en BD
 */
export async function getCatalogIdByAlias (alias) {
  if (!alias) return null
  if (_idByAlias.has(alias)) return _idByAlias.get(alias)

  const { rows } = await pool.query(
    'SELECT catalog_id FROM catalog WHERE alias = $1 LIMIT 1',
    [alias]
  )
  const id = rows?.[0]?.catalog_id ?? null
  if (id != null) _idByAlias.set(alias, id)
  return id
}

/**
 * Resuelve varios alias en paralelo. Util para cargar varios al inicio de una operacion.
 * @param {string[]} aliases
 * @returns {Promise<Object<string, number|null>>} mapa alias -> catalog_id
 */
export async function getCatalogIdsByAliases (aliases) {
  const entries = await Promise.all(
    aliases.map(async (a) => [a, await getCatalogIdByAlias(a)])
  )
  return Object.fromEntries(entries)
}

/**
 * Limpia el cache. Util en tests o cuando se sabe que el catalogo cambio en BD.
 */
export function clearCatalogCache () {
  _idByAlias.clear()
}
