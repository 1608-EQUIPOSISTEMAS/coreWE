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


// Estado "Anulada" de cuota (mismo catalogo que usa el flujo de Retiro). La
// fila NUNCA se borra: conserva monto y vencimiento originales; la causa vive
// en notes y en el audit log.
export const CAT_STATUS_ANNULLED = 4456

// Motivos de campaña de cobranza (etiqueta del reporte de casos).
export const CAMPAIGN_REASON_LABELS = {
  campana_cobranza: 'Campaña de cobranza',
  pago_adelantado: 'Descuento por pago adelantado',
  otro: 'Otro'
}

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

// Desglosa el cobro de una cuota que la empresa pago con detraccion (SPOT): un
// deposito va a nuestra cuenta y el otro a la cuenta de detracciones del Banco
// de la Nacion. Son dos vouchers, dos numeros de operacion y dos cuentas, pero
// UNA sola cuota.
//
// Solo entra el monto detraido; el pago se DERIVA como el resto. Es a proposito:
// si ambos montos se capturaran por separado, un error de tipeo cerraria la
// cuota con plata que nunca llego. Asi la suma cuadra por construccion.
//
// @param {number} installmentAmount  monto de la cuota, leido de BD
// @param {object|null} detraction    { amount, ... } o null si no hubo detraccion
// @returns {{ amount: number, detractionAmount: number }}
export function splitInstallmentDetraction (installmentAmount, detraction) {
  const total = Number(installmentAmount)
  if (!detraction) return { amount: total, detractionAmount: 0 }

  const detracted = Number(detraction.amount)
  if (!Number.isFinite(detracted) || detracted <= 0) {
    throw new DomainError('Monto de detraccion invalido')
  }
  if (detracted >= total) {
    throw new DomainError(`La detraccion (${fmtMoney(detracted)}) no puede cubrir toda la cuota (${fmtMoney(total)})`)
  }

  return {
    amount: Math.round((total - detracted) * 100) / 100,
    detractionAmount: Math.round(detracted * 100) / 100
  }
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
// Devuelve YYYY-MM-DD sin corrimiento de zona horaria. Acepta string ('...slice')
// o Date (node-pg arma las columnas `date` a medianoche local, asi que sus
// componentes locales son la fecha-calendario correcta en cualquier TZ).
function toIsoDate (d) {
  if (d == null) return ''
  if (typeof d === 'string') return d.slice(0, 10)
  const dt = d instanceof Date ? d : new Date(d)
  if (isNaN(dt.getTime())) return ''
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

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

    // Trabajamos con fechas-calendario como string YYYY-MM-DD para no arrastrar
    // el corrimiento de un dia que provoca new Date(str) (UTC) + setHours (local).
    const newIso = toIsoDate(raw.new_due_date)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newIso)) throw new DomainError(`Fecha invalida para cuota ${inst.installment_number}`)
    const oldIso = toIsoDate(inst.due_date)

    // ponytail: se permite adelantar o posponer la fecha (correccion libre de
    // back-office, todo auditado). Unico tope: no pasar el fin de la edicion.
    if (editionEnd) {
      const endIso = toIsoDate(editionEnd)
      if (newIso > endIso) {
        throw new DomainError(`La cuota ${inst.installment_number} no puede superar la fecha fin de la edicion (${endIso})`)
      }
    }

    normalizedChanges.push({
      installment_id: id,
      installment_number: inst.installment_number,
      old_due_date: oldIso,
      new_due_date: newIso
    })
    auditDiff[`Cuota ${inst.installment_number}`] = { old: oldIso, new: newIso }
  }

  return { normalizedChanges, auditDiff }
}

// Valida una campaña de cobranza contra las filas actuales. annulIds son las
// cuotas a anular (quedan con su monto original, tachadas); adjustments son
// ajustes de monto sobre cuotas que siguen vivas; payIds son cuotas que se
// pagan juntas en un solo pago (ej: "pago las 5 de una", "2 cuotas con el
// mismo voucher") — todas comparten la misma data de pago. Reglas: toda cuota
// debe pertenecer a la inscripcion, no estar pagada ni ya anulada, ni ser la
// inicial; una misma cuota solo admite UNA accion; debe haber al menos una
// operacion. payDiscount es el descuento de campaña sobre el pago consolidado
// ("no pagan 800, pagan 750"): payDiscountType 'percent' lo expresa como % del
// total a pagar (el caso tipico: 5% por pagar todo adelantado) y 'amount' como
// monto fijo (S/50-S/100 en epoca de CTS/grati). Se reparte proporcionalmente
// entre las cuotas pagadas (la ultima absorbe el redondeo) y entra al
// descuento del enrollment. Devuelve normalizados + diff de auditoria +
// totales (annulledTotal, payTotal original, paidTotal efectivo, payDiscount
// en soles, payDiscountPct informativo y discountDelta = plata anulada no
// absorbida por los ajustes + descuento del pago).
export function validateCampaign (annulIds, adjustments, byId, payIds = [], payDiscount = 0, payDiscountType = 'amount') {
  const annuls = (annulIds || []).map(Number).filter(Boolean)
  const adjusts = (adjustments || [])
  const pays = (payIds || []).map(Number).filter(Boolean)
  const rawDiscount = Number(payDiscount) || 0
  if (rawDiscount < 0) throw new DomainError('Descuento invalido')
  if (payDiscountType === 'percent' && rawDiscount >= 100) {
    throw new DomainError('El porcentaje de descuento debe ser menor a 100')
  }
  if (rawDiscount > 0 && pays.length === 0) {
    throw new DomainError('El descuento del pago requiere cuotas marcadas para pagar')
  }
  if (annuls.length === 0 && adjusts.length === 0 && pays.length === 0) {
    throw new DomainError('Debe anular, ajustar o pagar al menos una cuota')
  }
  const annulSet = new Set(annuls)
  const paySet = new Set(pays)
  if (pays.some(id => annulSet.has(id))) {
    throw new DomainError('Una cuota no puede anularse y pagarse a la vez')
  }

  const auditDiff = {}
  const assertAlive = (id) => {
    const inst = byId.get(Number(id))
    if (!inst) throw new DomainError(`Cuota ${id} no pertenece a la inscripcion`)
    if (inst.installment_number === 0) throw new DomainError('El pago inicial no participa en campañas')
    if (isPaidByCatStatus(inst.cat_status)) throw new DomainError(`La cuota ${inst.installment_number} ya esta pagada`)
    if (Number(inst.cat_status) === CAT_STATUS_ANNULLED) throw new DomainError(`La cuota ${inst.installment_number} ya esta anulada`)
    return inst
  }

  let annulledTotal = 0
  const normalizedAnnuls = annuls.map(id => {
    const inst = assertAlive(id)
    annulledTotal += Number(inst.amount) || 0
    auditDiff[`Cuota ${inst.installment_number}`] = { old: `${fmtMoney(inst.amount)} · Pendiente`, new: 'Anulada por estrategia de cobranza' }
    return { installment_id: Number(id), installment_number: inst.installment_number, amount: Number(inst.amount) || 0 }
  })

  let payTotal = 0
  const normalizedPays = pays.map(id => {
    const inst = assertAlive(id)
    const amount = Number(inst.amount) || 0
    payTotal += amount
    auditDiff[`Cuota ${inst.installment_number}`] = { old: `${fmtMoney(amount)} · Pendiente`, new: 'Pagada (pago consolidado de campaña)' }
    return { installment_id: Number(id), installment_number: inst.installment_number, amount, paid_amount: amount }
  })

  // El % se convierte a soles recien aqui, cuando ya se conoce el total a pagar.
  const discount = payDiscountType === 'percent'
    ? Math.round(payTotal * rawDiscount) / 100
    : rawDiscount

  if (discount > 0) {
    if (discount >= payTotal) throw new DomainError('El descuento no puede ser mayor o igual al total de las cuotas a pagar')
    const paidTarget = payTotal - discount
    let acc = 0
    normalizedPays.forEach((p, i) => {
      p.paid_amount = i === normalizedPays.length - 1
        ? Math.round((paidTarget - acc) * 100) / 100
        : Math.round(p.amount * (paidTarget / payTotal) * 100) / 100
      acc += p.paid_amount
      auditDiff[`Cuota ${p.installment_number}`] = {
        old: `${fmtMoney(p.amount)} · Pendiente`,
        new: `Pagada por ${fmtMoney(p.paid_amount)} (pago consolidado con descuento de campaña)`
      }
    })
  }

  let adjustDelta = 0
  const normalizedAdjusts = adjusts.map(raw => {
    const id = Number(raw.installment_id)
    if (annulSet.has(id)) throw new DomainError(`La cuota ${id} no puede anularse y ajustarse a la vez`)
    if (paySet.has(id)) throw new DomainError(`La cuota ${id} no puede pagarse y ajustarse a la vez`)
    const inst = assertAlive(id)
    const newAmount = Number(raw.new_amount)
    if (!Number.isFinite(newAmount) || newAmount <= 0) {
      throw new DomainError(`Monto invalido para la cuota ${inst.installment_number}`)
    }
    adjustDelta += newAmount - (Number(inst.amount) || 0)
    auditDiff[`Cuota ${inst.installment_number}`] = { old: fmtMoney(inst.amount), new: fmtMoney(newAmount) }
    return { installment_id: id, installment_number: inst.installment_number, old_amount: Number(inst.amount) || 0, new_amount: newAmount }
  })

  return {
    normalizedAnnuls,
    normalizedAdjusts,
    normalizedPays,
    auditDiff,
    annulledTotal,
    payTotal,
    payDiscount: discount,
    payDiscountPct: payDiscountType === 'percent' ? rawDiscount : null,
    paidTotal: payTotal - discount,
    discountDelta: annulledTotal - adjustDelta + discount
  }
}

// Construye la nota de auditoria de la campaña de cobranza.
export function buildCampaignAuditDetails ({ reasonCode, annulCount, adjustCount, payCount, paidTotal, payDiscount, payDiscountPct, discountDelta, odooResult, hasOrder, odooErrorSummary }) {
  const reasonLabel = CAMPAIGN_REASON_LABELS[reasonCode] || 'Otro'
  const parts = [`Motivo: ${reasonLabel}`]
  if (payCount) {
    const discNote = payDiscount > 0
      ? `, con descuento de ${payDiscountPct != null ? `${payDiscountPct}% = ` : ''}${fmtMoney(payDiscount)}`
      : ''
    parts.push(`${payCount} cuota(s) pagada(s) en un solo pago (${fmtMoney(paidTotal || 0)}${discNote})`)
  }
  if (annulCount) parts.push(`${annulCount} cuota(s) anulada(s)`)
  if (adjustCount) parts.push(`${adjustCount} cuota(s) ajustada(s)`)
  if (discountDelta > 0.001) parts.push(`descuento por cobranza ${fmtMoney(discountDelta)}`)
  const odooNote = odooResult?.success === false
    ? ` | Odoo: FALLO (${odooErrorSummary})`
    : (hasOrder ? ' | Odoo: sincronizado' : ' | Odoo: sin orden asociada')
  return parts.join(' — ') + odooNote
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
