// Helpers para ejecucion segura de operaciones que pueden fallar sin bloquear el flujo principal.
// Reemplaza los patrones inconsistentes de try/catch + console.error que estaban dispersos.

/**
 * Ejecuta una funcion async y captura cualquier error.
 * Si falla, loguea con prefijo y devuelve null. No relanza.
 * Util para operaciones secundarias (Odoo, email, Slack) donde el flujo principal
 * NO debe fallar aunque la operacion secundaria falle.
 *
 * @param {string} prefix - prefijo para el log (ej. '[FICO][Odoo]')
 * @param {Function} fn - funcion async a ejecutar
 * @returns {Promise<any|null>} resultado de fn o null si fallo
 */
export async function safeAsync (prefix, fn) {
  try {
    return await fn()
  } catch (err) {
    console.error(`${prefix} failed:`, err?.message || err)
    return null
  }
}

/**
 * Wrapper especifico para operaciones de Odoo. Loguea con prefijo [Odoo] y
 * devuelve { success, error, data } uniforme.
 *
 * @param {string} operation - nombre de la operacion (ej. 'enrollUser')
 * @param {Function} fn - funcion async a ejecutar
 * @returns {Promise<{success: boolean, data: any, error: string|null}>}
 */
export async function safeOdooSync (operation, fn) {
  try {
    const data = await fn()
    return { success: true, data, error: null }
  } catch (err) {
    const msg = err?.message || String(err)
    console.error(`[Odoo][${operation}] failed:`, msg)
    return { success: false, data: null, error: msg }
  }
}
