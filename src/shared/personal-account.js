import { pool } from './db/pool.js'

// Etiqueta "CUENTA PERSONAL": el alumno lleva el curso de IA con SU PROPIA
// cuenta de Claude o ChatGPT, asi que Academica NO le entrega una en ese modulo
// (confirmado 06/10/26: la leen en la Lista de Notas del aula). Ningun member
// recibe cuenta gratis: el que no adjunta comprobante usa la suya y se etiqueta.
//
// Vive en enrollments.personal_account, una por modulo (hijo SEG). Solo los
// modulos de CLAUDE o CHATGPT usan cuenta, y cada uno toma el proveedor de su
// propio nombre: un Diplomado con los dos lleva CHATGPT en uno y CLAUDE en otro.
// En RP/CC Producto decidio que no viaje sola: FICO la pone a mano.

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

// Proveedores de los beneficios CUENTA de la venta (S/100 y S/200) como
// subconsulta: el beneficio vive en enrollment_discounts, no en la fila.
// `enrollmentIdSql` es la expresion SQL del enrollment vendido.
export const accountProvidersSql = enrollmentIdSql => `ARRAY(
  SELECT DISTINCT CASE WHEN d.alias LIKE 'cuenta_claude%' THEN 'CLAUDE' ELSE 'CHATGPT' END
    FROM public.enrollment_discounts ed
    JOIN public.discounts d ON d.discount_id = ed.discount_id
   WHERE ed.enrollment_id = ${enrollmentIdSql}
     AND (d.alias LIKE 'cuenta_claude%' OR d.alias LIKE 'cuenta_chatgpt%'))`

// Proveedor del modulo segun su nombre, o null si el modulo no usa cuenta.
export function moduleProvider (moduleName) {
  const name = String(moduleName || '').toUpperCase()
  return PERSONAL_ACCOUNT_PROVIDERS.find(p => name.includes(p)) ?? null
}

// Etiqueta que hereda un hijo SEG al crearse. parent.account_providers son los
// beneficios CUENTA de la venta (puede traer los dos); personal_account_modules
// acota a los modulos que marco la asesora (S/100), null = todos.
export function childPersonalAccount (parent, child) {
  const provider = moduleProvider(child?.name)
  const providers = [parent?.personal_account, ...(parent?.account_providers ?? [])].map(normalizePersonalAccount)
  if (!provider || !providers.includes(provider)) return null
  const modules = normalizePersonalAccountModules(parent?.personal_account_modules)
  return !modules || modules.includes(Number(child.pvId)) ? provider : null
}

// Etiqueta que lee Academica en el aula: la misma regla que al crear el hijo,
// pero evaluada al leer con los beneficios ACTUALES de la venta. Asi cubre lo
// que no la escribe al registrar (FICO directo, que es por donde entran los
// members) y el beneficio agregado despues, y corrige hijos viejos que la
// heredaron en todos los modulos (antes del 06/10/26).
export function studentPersonalAccount ({ personal_account, sold_account_providers, module_name } = {}) {
  return childPersonalAccount(
    { personal_account, account_providers: sold_account_providers },
    { name: module_name }
  )
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
