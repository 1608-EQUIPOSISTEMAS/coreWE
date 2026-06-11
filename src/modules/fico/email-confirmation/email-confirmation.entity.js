// Reglas puras del dominio de correos transaccionales FICO. Sin pool, odoo,
// email ni reloj oculto: todo entra por parametros y se opera sobre datos en
// memoria. Esto permite probar las decisiones (alumno nuevo vs retornante,
// progreso de cuotas, fecha de activacion) sin levantar BD ni red.

export const SYNTHETIC_ODOO_DOMAIN = '@weeducacion.edu.pe'
export const MEMBERSHIP_DEFAULT_PASSWORD = '1234567'

// Aliases de estado de cuota que cuentan como pagada para el correo de progreso.
export const PAID_INSTALLMENT_ALIASES = new Set(['we_inst_paid', 'we_payment_status_paid'])

// Primer token de un nombre compuesto (first name / apellido principal).
export function firstWord (raw) {
  return (raw || '').trim().split(/\s+/)[0] || ''
}

// Correo Odoo sintetico proyectado (apellido.nombre@dominio) usado cuando aun
// no hay odoo_email persistido. Solo apto para preview; el envio real exige el
// odoo_email guardado.
export function synthesizeOdooEmail (firstName, lastName) {
  return `${firstWord(lastName).toLowerCase()}.${firstWord(firstName).toLowerCase()}${SYNTHETIC_ODOO_DOMAIN}`
}

// Decide si el correo de confirmacion va como "alumno nuevo" (credenciales) o
// "alumno retornante" (bloque recupera tu password). Combina dos senales ya
// resueltas por el repository:
//   - isFirstSend: no hubo envio previo exitoso de este enrollment.
//   - hasPriorEnrollment: el mismo customer tiene otro enrollment con odoo_user_id.
//   - odooEmail: si NO termina en el dominio sintetico, ya esta ligado a un Odoo real.
// isNew solo es true en el primer envio Y cuando no es retornante.
export function resolveConfirmationEmailMode ({ isFirstSend, hasPriorEnrollment, odooEmail }) {
  const linkedToExistingOdoo = !!odooEmail && !String(odooEmail).toLowerCase().endsWith(SYNTHETIC_ODOO_DOMAIN)
  const isReturningStudent = !!hasPriorEnrollment || linkedToExistingOdoo
  const isNew = isFirstSend && !isReturningStudent
  return { isFirstSend, isReturningStudent, isNew }
}

// Normaliza las credenciales SAP que FICO escribio a mano. Recorta espacios y
// reporta si ambas estan completas. `complete` es la senal que usa el envio para
// decidir si pinta el bloque SAP y, en el borde HTTP, si exige el ingreso.
export function normalizeSapCredentials ({ sapUsername, sapPassword } = {}) {
  const username = String(sapUsername ?? '').trim()
  const password = String(sapPassword ?? '').trim()
  return { username, password, complete: username.length > 0 && password.length > 0 }
}

// Etiqueta de tipo de programa para el asunto/cuerpo del correo de cuota.
export function resolveProgramTypeLabel (categoryDescription) {
  const raw = (categoryDescription || '').trim().toUpperCase()
  if (raw === 'ESP.' || raw === 'ESPECIALIZACION') return 'Especializacion'
  if (raw === 'DIPLOMADO') return 'Diplomado'
  if (raw === 'PEE') return 'PEE'
  return 'curso'
}

// Progreso de pago para el correo de confirmacion de cuota. paidCount >= total
// significa "Pago Completado". Resuelve tambien la ultima cuota pagada y la
// proxima pendiente para poblar la plantilla.
export function resolvePaymentProgress (installments = []) {
  const paidCount = installments.filter(i => PAID_INSTALLMENT_ALIASES.has(i.status_alias)).length
  const isLastPayment = installments.length > 0 && paidCount >= installments.length
  const nextInstallment = installments.find(i => !PAID_INSTALLMENT_ALIASES.has(i.status_alias)) || null
  const lastPaid = [...installments].reverse().find(i => PAID_INSTALLMENT_ALIASES.has(i.status_alias)) || null
  return { paidCount, isLastPayment, nextInstallment, lastPaid }
}

// Tabla HTML "CRONOGRAMA DE PAGOS" del correo de membresia. Devuelve '' si no
// hay cuotas. El symbol de moneda y las filas vienen ya resueltas por el caller.
export function buildInstallmentsTableHTML (installments = [], currencySymbol = 'S/.') {
  if (!installments || installments.length === 0) return ''
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  const fechasCells = installments.map(i => {
    const d = new Date(i.due_date)
    return `<td><font face="Tahoma" size="2">${String(d.getUTCDate()).padStart(2, '0')} ${meses[d.getUTCMonth()]}</font></td>`
  }).join('')
  const pagosCells = installments.map(i => `<td><font face="Tahoma" size="2">${currencySymbol} ${Math.trunc(Number(i.amount || 0))}</font></td>`).join('')
  return `
        <table width="450" border="2" align="center" style="border-collapse:collapse;text-align:center;">
          <thead><tr><td colspan="${installments.length + 1}" style="background-color:rgb(5,36,103);color:white;"><font face="Tahoma" size="2">CRONOGRAMA DE PAGOS</font></td></tr></thead>
          <tbody>
            <tr><td style="background-color:rgb(5,36,103);color:white;"><font face="Tahoma" size="2">Fechas</font></td>${fechasCells}</tr>
            <tr><td style="background-color:rgb(5,36,103);color:white;"><font face="Tahoma" size="2">Pago</font></td>${pagosCells}</tr>
          </tbody>
        </table>`
}

// Fecha de inicio para preview de membresia. Prioridad: activationDate elegida
// en vivo (solo si es YYYY-MM-DD valido) > fecha persistida > start_date de
// edicion > hoy. La fecha "hoy" se inyecta para no depender del reloj.
export function resolvePreviewActivationStart ({ activationDate, persistedDate, editionStartDate, now = new Date() }) {
  if (activationDate && /^\d{4}-\d{2}-\d{2}$/.test(String(activationDate).trim())) {
    return new Date(activationDate)
  }
  const raw = persistedDate || editionStartDate
  return raw ? new Date(raw) : now
}

// Fecha de inicio para el envio real de membresia. Prioridad fija: fecha
// persistida > start_date de edicion > hoy (inyectado).
export function resolveSendActivationStart ({ persistedDate, editionStartDate, now = new Date() }) {
  const raw = persistedDate || editionStartDate
  return raw ? new Date(raw) : now
}

// Nombre de archivo seguro para el adjunto de cronograma a partir del programa.
export function safeAttachmentName (programName, fallback = 'Programa') {
  return (programName || fallback).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Indica si la inscripcion debe ocultar la tabla de cuotas (pago al contado).
export function isSinglePayment (paymentPlanAlias) {
  return paymentPlanAlias === 'we_payment_way_single'
}
