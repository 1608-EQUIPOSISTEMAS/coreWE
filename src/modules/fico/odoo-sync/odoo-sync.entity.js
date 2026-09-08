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

// Un paquete sin edicion es una inscripcion a un programa con modulos en su
// estructura (childrenCount > 0) que no apunta a ninguna edicion programada.
// Se llega ahi por dos caminos distintos que esta regla NO distingue:
//   - E0: paquete en vivo cuya edicion todavia no se programa.
//   - Producto online: por diseño no tiene program_editions.
// En ambos el padre es un envoltorio comercial sin curso propio en el campus:
// lo que se inscribe en Odoo son sus modulos. Se llamaba `isE0Parent`, y ese
// nombre hizo creer que el caso online no pasaba por aca.
export function isPackageWithoutEdition ({ programEditionId, childrenCount }) {
  return programEditionId == null && Number(childrenCount) > 0
}

// Mapea el alias de moneda del enrollment al codigo de moneda Odoo.
// we_currency_usd -> USD, cualquier otro -> PEN.
export function resolveCurrencyCode (currencyAlias) {
  return currencyAlias === 'we_currency_usd' ? 'USD' : 'PEN'
}

// Nombre del alumno como lo espera Odoo: "APELLIDOS NOMBRES" en mayusculas.
// El materno va incluido: sin el, el partner quedaba como "CUEVA BIANCA" en vez
// de "CUEVA VARGAS BIANCA".
export function buildOdooFullName ({ firstName, lastName, motherLastName }) {
  return [lastName, motherLastName, firstName]
    .map(v => String(v || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean).join(' ').toUpperCase()
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

// Estado con el que Odoo marca una cuota saldada (lo escribe markFeeAsPaid y lo
// lee la campaña de cobranza).
export const ODOO_FEE_STATE_PAID = 'pagado'

// Resuelve QUE cuota de Odoo corresponde a la que FICO acaba de confirmar.
//
// Antes se marcaba siempre la primera pendiente, sin mirar el numero de cuota.
// Cuando el alumno pagaba por Mercado Pago, Odoo saldaba esa cuota por su cuenta;
// al confirmar FICO el mismo pago en el ERP, la primera pendiente ya era la
// SIGUIENTE y quedaba marcada tambien: el alumno veia una cuota de mas pagada en
// su campus y creia estar al dia.
//
// Emparejar por `seq` deja el flujo idempotente: si Mercado Pago llego primero,
// la cuota aparece 'pagado' y el ERP no toca nada.
export function selectFeeForInstallment (fees = [], installmentNumber) {
  const target = Number(installmentNumber)
  const fee = (fees || []).find(f => Number(f.seq) === target) || null
  if (!fee) return { fee: null, alreadyPaid: false }
  return { fee, alreadyPaid: fee.state === ODOO_FEE_STATE_PAID }
}
