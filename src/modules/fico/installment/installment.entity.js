import { DomainError } from '../../../shared/errors.js'

// Reglas e invariantes puras del dominio de cuotas (payment_installments).
// Sin acceso a BD, red ni reloj oculto: el tiempo y las filas ya leidas entran
// por parametros. Esto las hace testeables sin levantar nada.

// Una cuota se considera saldada en cualquiera de los dos namespaces que
// conviven en el sistema: 'we_inst_paid' (legacy, id=4454) y
// 'we_payment_status_paid' (nuevo, id=2471).
export const PAID_STATUS_ALIASES = new Set(['we_inst_paid', 'we_payment_status_paid'])
export const PAID_STATUS_IDS = new Set([4454, 2471])

// Estado de cuota saldada que escribe confirmInstallment (hardcode legacy).
export const CAT_STATUS_PAID = 4454

// Fila de payments creada al confirmar una cuota.
export const CAT_PAYMENT_TYPE_INSTALLMENT = 3115
export const CAT_SETTLEMENT_STATUS_PAID = 2573

// Etiquetas de motivo de reprogramacion para el detalle de auditoria.
export const RESCHEDULE_REASON_LABELS = { financiero: 'Financiero', academico: 'Academico', personal: 'Personal', otro: 'Otro' }

// Verdadero si el alias de estado corresponde a una cuota ya pagada.
export function isPaidByAlias (statusAlias) {
  return PAID_STATUS_ALIASES.has(statusAlias)
}

// Verdadero si el id de estado corresponde a una cuota ya pagada.
export function isPaidByCatStatus (catStatus) {
  return PAID_STATUS_IDS.has(Number(catStatus))
}

// Formateadores de presentacion usados en los detalles de auditoria.
export const fmtMoney = n => `S/. ${Number(n).toFixed(2)}`
export const fmtFecha = iso => iso.split('-').reverse().join('/')

// Valida los datos de edicion de monto de una cuota pendiente contra la fila ya
// leida de BD. Lanza DomainError con el mensaje exacto del flujo legacy o
// devuelve los montos normalizados si todo es coherente.
export function assertEditableAmount (inst, newAmount) {
  const amt = Number(newAmount)
  if (!Number.isFinite(amt) || amt <= 0) throw new DomainError('Monto invalido')
  if (!inst) throw new DomainError('Cuota no encontrada para esta inscripcion')
  if (inst.installment_number === 0) throw new DomainError('Usa el flujo de pago inicial para esa fila')
  if (isPaidByAlias(inst.status_alias)) {
    throw new DomainError('No se puede editar el monto de una cuota ya pagada')
  }
  const oldAmount = Number(inst.amount || 0)
  if (Math.abs(oldAmount - amt) < 0.001) throw new DomainError('El monto nuevo es igual al actual')
  return { oldAmount, newAmount: amt }
}

// Normaliza y valida la fecha de vencimiento de una cuota nueva. Exige formato
// ISO YYYY-MM-DD identico al guard del service legacy.
export function normalizeDueDate (dueDate) {
  if (!dueDate) throw new DomainError('Fecha de vencimiento obligatoria')
  const isoDate = String(dueDate).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new DomainError('Fecha invalida (formato YYYY-MM-DD)')
  return isoDate
}

// Valida el monto de una cuota a agregar.
export function assertAddAmount (amount) {
  const amt = Number(amount)
  if (!Number.isFinite(amt) || amt <= 0) throw new DomainError('Monto invalido')
  return amt
}

// Siguiente installment_number a partir del maximo existente (excluye el 0).
export function nextInstallmentNumber (maxExistingNumber) {
  return Number(maxExistingNumber || 0) + 1
}

// Valida un conjunto de cambios de reprogramacion contra las filas actuales y la
// fecha fin de edicion. El "hoy" no participa: la regla es fecha nueva > actual y
// <= fin de edicion. Devuelve los cambios normalizados y el diff de auditoria, o
// lanza DomainError con el mensaje exacto del legacy.
//
// @param {Array<object>} changes        [{ installment_id, new_due_date }]
// @param {Map<number,object>} byId       installment_id -> fila actual
// @param {Date|null} editionEnd          fecha fin de la edicion (o null)
// @returns {{ normalizedChanges: Array, auditDiff: object }}
export function validateReschedule (changes, byId, editionEnd) {
  const normalizedChanges = []
  const auditDiff = {}

  for (const raw of changes) {
    const id = Number(raw.installment_id)
    const inst = byId.get(id)
    if (!inst) throw new DomainError(`Cuota ${id} no pertenece a la inscripcion`)
    if (inst.installment_number === 0) throw new DomainError('El pago inicial no se reprograma')
    if (isPaidByCatStatus(inst.cat_status)) {
      throw new DomainError(`La cuota ${inst.installment_number} ya esta pagada`)
    }

    const newDate = new Date(raw.new_due_date)
    if (isNaN(newDate.getTime())) throw new DomainError(`Fecha invalida para cuota ${inst.installment_number}`)

    const oldDate = new Date(inst.due_date)
    newDate.setHours(0, 0, 0, 0)
    oldDate.setHours(0, 0, 0, 0)

    if (newDate <= oldDate) {
      throw new DomainError(`La nueva fecha de la cuota ${inst.installment_number} debe ser posterior a la actual (${oldDate.toISOString().slice(0, 10)})`)
    }
    if (editionEnd) {
      const endCopy = new Date(editionEnd); endCopy.setHours(0, 0, 0, 0)
      if (newDate > endCopy) {
        throw new DomainError(`La cuota ${inst.installment_number} no puede superar la fecha fin de la edicion (${endCopy.toISOString().slice(0, 10)})`)
      }
    }

    normalizedChanges.push({
      installment_id: id,
      installment_number: inst.installment_number,
      old_due_date: oldDate.toISOString().slice(0, 10),
      new_due_date: newDate.toISOString().slice(0, 10)
    })
    auditDiff[`Cuota ${inst.installment_number}`] = {
      old: oldDate.toISOString().slice(0, 10),
      new: newDate.toISOString().slice(0, 10)
    }
  }

  return { normalizedChanges, auditDiff }
}

// Resume el resultado de Odoo en un texto de error legible para auditoria.
export function summarizeOdooError (odooResult) {
  if (odooResult?.success !== false) return null
  if (odooResult.error) return odooResult.error
  if (odooResult.failed?.length) {
    return odooResult.failed.map(f => `Cuota ${f.seq}: ${f.error}`).join('; ')
  }
  return 'Error desconocido'
}

// Construye la nota de Odoo del detalle de auditoria de reprogramacion.
export function buildRescheduleAuditDetails ({ reasonCode, count, odooResult, hasOrder, odooErrorSummary }) {
  const reasonLabel = RESCHEDULE_REASON_LABELS[reasonCode] || 'Otro'
  const odooNote = odooResult?.success === false
    ? ` | Odoo: FALLO (${odooErrorSummary})`
    : (hasOrder ? ' | Odoo: sincronizado' : ' | Odoo: sin orden asociada')
  return `Motivo: ${reasonLabel} — ${count} cuota(s) reprogramada(s)${odooNote}`
}
