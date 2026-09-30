import { pool } from './db/pool.js'

// Etiqueta "CUENTA PERSONAL": el alumno lleva el curso de IA con su propia
// cuenta de Claude o ChatGPT y Academica le entrega una por cada modulo marcado.
//
// Vive en enrollments.personal_account y NO se deriva del beneficio: en un
// paquete el beneficio va en el padre, pero la cuenta se entrega por modulo
// (S/100 = uno, S/200 = todos), y en RP/CC Producto decidio que no viaje sola
// (depende de que el alumno pague otra vez la cuenta): FICO la pone a mano.

export const PERSONAL_ACCOUNT_PROVIDERS = ['CLAUDE', 'CHATGPT']

// Proveedor valido o null. Entra por el body del request: whitelist.
export function normalizePersonalAccount (value) {
  const v = String(value || '').trim().toUpperCase()
  return PERSONAL_ACCOUNT_PROVIDERS.includes(v) ? v : null
}

// Lista de program_version_id de modulos, o null (= todos los modulos).
export function normalizePersonalAccountModules (value) {
  if (!Array.isArray(value)) return null
  const ids = [...new Set(value.map(Number).filter(n => Number.isInteger(n) && n > 0))]
  return ids.length ? ids : null
}

// Etiqueta que hereda un hijo SEG al crearse: la del padre si su modulo esta
// entre los elegidos (lista vacia/null = todos).
export function childPersonalAccount (parent, childPvId) {
  const provider = normalizePersonalAccount(parent?.personal_account)
  if (!provider) return null
  const modules = normalizePersonalAccountModules(parent?.personal_account_modules)
  return !modules || modules.includes(Number(childPvId)) ? provider : null
}

// Escribe la etiqueta de una inscripcion (null la quita).
export async function setPersonalAccount (db, enrollmentId, { provider, modules }) {
  const p = normalizePersonalAccount(provider)
  await db.query(
    'UPDATE public.enrollments SET personal_account = $1, personal_account_modules = $2 WHERE enrollment_id = $3',
    [p, p ? normalizePersonalAccountModules(modules) : null, enrollmentId]
  )
  return p
}

// sp_fico_enrollment_list y su matview no conocen la columna: se enriquece la
// fila despues, igual que attachEventCategory. Tambien el program_version_id,
// que la matview no expone y el RP necesita para listar los modulos. Nunca lanza.
export async function attachPersonalAccount (rows, db = pool) {
  const list = Array.isArray(rows) ? rows : [rows]
  const ids = [...new Set(list.map(r => Number(r?.enrollment_id)).filter(Number.isInteger))]
  if (!ids.length) return rows
  try {
    const { rows: found } = await db.query(
      `SELECT enrollment_id, program_version_id, personal_account, personal_account_modules
         FROM public.enrollments
        WHERE enrollment_id = ANY($1::int[])`,
      [ids]
    )
    const byId = new Map(found.map(r => [Number(r.enrollment_id), r]))
    for (const row of list) {
      const hit = byId.get(Number(row?.enrollment_id))
      row.program_version_id ??= hit?.program_version_id ?? null
      row.personal_account = hit?.personal_account ?? null
      row.personal_account_modules = hit?.personal_account_modules ?? null
    }
  } catch (err) {
    console.error('[attachPersonalAccount] no se pudo resolver la etiqueta:', err.message)
  }
  return rows
}
