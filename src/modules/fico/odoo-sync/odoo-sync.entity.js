// Reglas e invariantes puras del sync de inscripciones de cursos con Odoo.
// Sin acceso a BD, Odoo ni reloj oculto: todo entra por parametros (incluida la
// fecha de inicio de la edicion) y se decide sobre datos en memoria. Esto las
// hace testeables sin levantar nada.

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]

// Password sintetico fijo del usuario Odoo creado por FICO.
export const ODOO_DEFAULT_PASSWORD = '1234567'

// Una inscripcion esta en E0 padre cuando no tiene edicion programada
// (program_edition_id NULL) y ademas tiene hijos en la estructura del programa.
// En ese caso los hijos se inscriben individualmente y el padre no se sincroniza.
export function isE0Parent ({ programEditionId, childrenCount }) {
  return programEditionId == null && Number(childrenCount) > 0
}

// Mapea el alias de moneda del enrollment al codigo de moneda Odoo.
// we_currency_usd -> USD, cualquier otro -> PEN.
export function resolveCurrencyCode (currencyAlias) {
  return currencyAlias === 'we_currency_usd' ? 'USD' : 'PEN'
}

// Nombre del alumno como lo espera Odoo: "APELLIDO NOMBRE" en mayusculas.
export function buildOdooFullName ({ firstName, lastName }) {
  return `${(lastName || '').trim()} ${(firstName || '').trim()}`.trim().toUpperCase()
}

// Construye el nombre de busqueda del curso presencial en Odoo a partir de la
// activacion y la fecha de inicio de la edicion (Date o ISO string). Formato:
// "{activacion} (dd/mm) - {Mes} {anio}", usando componentes UTC.
export function buildPresentialCourseName ({ odooActivation, startDate }) {
  const d = new Date(startDate)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${odooActivation} (${dd}/${mm}) - ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

// Determina el login (searchEmail) a usar en Odoo segun prioridad:
//   1) login del odoo_user_id previo del mismo DNI (fuente mas confiable).
//   2) origin_email real del alumno normalizado (cubre cuentas Odoo antiguas).
//   3) email sintetico generado (fallback para alumno realmente nuevo).
// Recibe los resultados ya consultados a Odoo; no hace red.
export function resolveSearchEmail ({ createEmail, prevUserLogin, originEmail, existingUserByRealEmailLogin }) {
  if (prevUserLogin) return prevUserLogin
  if (existingUserByRealEmailLogin) return existingUserByRealEmailLogin
  return createEmail
}

// Normaliza el origin_email a minusculas sin espacios. Devuelve '' si no hay.
export function normalizeOriginEmail (originEmail) {
  return originEmail ? String(originEmail).trim().toLowerCase() : ''
}

// Mapea las cuotas planificadas al shape que espera createSaleOrderWithFees,
// formateando la fecha de vencimiento a YYYY-MM-DD (UTC). Devuelve null si no
// hay cuotas para no enviar una lista vacia a Odoo.
export function mapInstallmentsForOdoo (installmentRows) {
  if (!installmentRows || installmentRows.length === 0) return null
  return installmentRows.map(i => ({
    amount: Number(i.amount),
    due_date: i.due_date ? new Date(i.due_date).toISOString().slice(0, 10) : null
  }))
}
