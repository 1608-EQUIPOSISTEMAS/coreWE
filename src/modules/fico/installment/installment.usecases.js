import { DomainError } from '../../../shared/errors.js'
import { safeAsync } from '../../../shared/utils/safe-async.js'
import { installmentRepository } from './installment.repository.js'
import {
  isPaidByAlias,
  assertEditableAmount,
  assertAddAmount,
  normalizeDueDate,
  nextInstallmentNumber,
  validateReschedule,
  summarizeOdooError,
  buildRescheduleAuditDetails,
  fmtMoney,
  fmtFecha
} from './installment.entity.js'

// Orquestacion de los casos de uso de cuotas. No contiene SQL (delega en el
// repository) ni invariantes (delegan en la entity). Los side-effects (Odoo,
// correo, auditoria) viven fuera de las transacciones: un fallo de ellos no
// revierte el cobro o la reprogramacion ya persistidos.

const repo = installmentRepository

// Confirma una cuota individual: transaccion atomica (cuota + payment + moneda +
// token) y, fuera de ella, auditoria, sync a Odoo y correo de confirmacion.
// Errores de validacion preservan el codigo 500 del flujo legacy.
export async function confirmInstallment ({ installmentId, enrollmentId, catCurrency, catPaymentMedium, catBusinessEntity, bankAccountId, transactionCode, voucherUrl, paymentDate, userId }) {
  const inst = await repo.findInstallmentWithStatus(installmentId, enrollmentId)
  if (!inst) throw new DomainError('Cuota no encontrada', { statusCode: 500 })
  if (isPaidByAlias(inst.status_alias)) {
    throw new DomainError('Esta cuota ya esta pagada', { statusCode: 500 })
  }

  const paidAt = paymentDate ? new Date(paymentDate) : new Date()

  await repo.confirmInstallmentTx({
    installmentId,
    enrollmentId,
    amount: inst.amount,
    paidAt,
    transactionCode,
    catPaymentMedium,
    bankAccountId,
    voucherUrl,
    catCurrency,
    userId
  })

  await repo.logAudit({
    enrollmentId,
    action: 'approved',
    userId,
    details: `Cuota ${inst.installment_number} confirmada: S/. ${inst.amount}`
  })

  try {
    const odooResult = await repo.syncInstallmentPaymentToOdoo({ enrollmentId, installmentNumber: inst.installment_number })
    if (odooResult?.success) {
      await repo.logAudit({ enrollmentId, action: 'odoo_fee_paid', userId, details: `Cuota ${inst.installment_number} sincronizada con Odoo (fee_id: ${odooResult.fee_id})` })
    }
  } catch (odooErr) {
    console.error('[confirmInstallment] Odoo sync:', odooErr.message)
  }

  const emailResult = await safeAsync(
    '[confirmInstallment][Email]',
    () => repo.sendPaymentConfirmationEmail({ enrollmentId })
  )

  if (emailResult?.success) {
    await repo.logAudit({
      enrollmentId,
      action: 'email_sent',
      userId,
      details: `Correo confirmacion cuota ${inst.installment_number} enviado`
    })
  } else {
    await repo.logAudit({
      enrollmentId,
      action: 'email_failed',
      userId,
      details: `Error al enviar correo de cuota ${inst.installment_number}: ${emailResult?.error || 'desconocido'}`
    })
  }

  return {
    result: 1,
    message: 'Cuota confirmada',
    email_sent: emailResult?.success === true
  }
}

// Edita el monto de UNA cuota pendiente. Audita old -> new con justificacion.
export async function editInstallmentAmount ({ enrollmentId, installmentId, newAmount, justificacion, userId }) {
  if (!justificacion || !justificacion.trim()) throw new DomainError('Justificacion obligatoria')

  const inst = await repo.findInstallmentForAmountEdit(installmentId, enrollmentId)
  const { oldAmount, newAmount: amt } = assertEditableAmount(inst, newAmount)

  await repo.updateInstallmentAmount(installmentId, amt)

  const changes = {
    [`Monto cuota #${inst.installment_number}`]: { old: fmtMoney(oldAmount), new: fmtMoney(amt) }
  }
  const details = `Monto cuota #${inst.installment_number}: ${fmtMoney(oldAmount)} → ${fmtMoney(amt)}`

  await repo.logAudit({
    enrollmentId,
    action: 'installment_amount_edited',
    userId,
    justificacion,
    changes,
    details
  })

  return { result: 1, message: 'Monto actualizado', old_amount: oldAmount, new_amount: amt }
}

// Agrega UNA cuota a una inscripcion aprobada. Calcula el siguiente
// installment_number y la deja en estado Pendiente.
export async function addInstallment ({ enrollmentId, amount, dueDate, justificacion, userId }) {
  const amt = assertAddAmount(amount)
  if (!justificacion || !justificacion.trim()) throw new DomainError('Justificacion obligatoria')
  const isoDate = normalizeDueDate(dueDate)

  const enrollment = await repo.findActiveEnrollment(enrollmentId)
  if (!enrollment) throw new DomainError('Inscripcion no encontrada')

  const pendingStatusId = await repo.findCatalogIdByAlias('we_inst_pending')
  if (!pendingStatusId) throw new DomainError('Catalogo we_inst_pending no encontrado')

  const nextNum = nextInstallmentNumber(await repo.findMaxInstallmentNumber(enrollmentId))

  const installmentId = await repo.insertInstallment({
    enrollmentId,
    installmentNumber: nextNum,
    amount: amt,
    dueDate: isoDate,
    catStatus: pendingStatusId
  })

  const changes = {
    [`Cuota #${nextNum}`]: { old: '---', new: `${fmtMoney(amt)} · vence ${fmtFecha(isoDate)}` }
  }
  const details = `Cuota #${nextNum} agregada: ${fmtMoney(amt)}, vence ${fmtFecha(isoDate)}`

  await repo.logAudit({
    enrollmentId,
    action: 'installment_added',
    userId,
    justificacion,
    changes,
    details
  })

  return {
    result: 1,
    message: 'Cuota agregada',
    installment_id: installmentId,
    installment_number: nextNum
  }
}

// Reprograma fechas de vencimiento de cuotas no pagadas dentro de la ventana de
// edicion y sincroniza con Odoo. La escritura es atomica; el sync a Odoo es
// best-effort y su resultado se refleja en la auditoria y la respuesta.
export async function rescheduleInstallments ({ enrollmentId, changes, justificacion, reasonCode, userId }) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new DomainError('Debe especificar al menos una cuota a reprogramar')
  }
  if (!justificacion || !justificacion.trim()) {
    throw new DomainError('La justificacion es obligatoria')
  }

  const enrollment = await repo.findEnrollmentForReschedule(enrollmentId)
  if (!enrollment) throw new DomainError('Inscripcion no encontrada')

  const installmentIds = changes.map(c => Number(c.installment_id)).filter(Boolean)
  const currentInst = await repo.findInstallmentsByIds(enrollmentId, installmentIds)

  const byId = new Map()
  for (const i of currentInst) byId.set(Number(i.installment_id), i)

  const editionEnd = enrollment.edition_end_date ? new Date(enrollment.edition_end_date) : null
  const { normalizedChanges, auditDiff } = validateReschedule(changes, byId, editionEnd)

  await repo.applyRescheduleTx(enrollmentId, normalizedChanges)

  let odooResult = { success: true, updated: 0, skipped: true }
  if (enrollment.odoo_order_id) {
    try {
      odooResult = await repo.updateOdooFeeDueDates(enrollment.odoo_order_id, normalizedChanges)
      console.log('[rescheduleInstallments] Odoo result:', JSON.stringify(odooResult))
    } catch (err) {
      console.error('[rescheduleInstallments] Odoo sync exception:', err.message, err.stack)
      odooResult = { success: false, error: err.message }
    }
  } else {
    console.log('[rescheduleInstallments] Sin odoo_order_id, sync omitido')
  }

  const odooErrorSummary = summarizeOdooError(odooResult)
  const details = buildRescheduleAuditDetails({
    reasonCode,
    count: normalizedChanges.length,
    odooResult,
    hasOrder: !!enrollment.odoo_order_id,
    odooErrorSummary
  })

  await repo.logAudit({
    enrollmentId,
    action: 'installments_rescheduled',
    userId,
    justificacion: justificacion.trim(),
    changes: auditDiff,
    details
  })

  return {
    result: 1,
    message: 'Cuotas reprogramadas correctamente',
    updated: normalizedChanges.length,
    odoo_sync: odooResult?.success !== false,
    odoo_error: odooErrorSummary,
    odoo_failed_fees: odooResult?.failed || [],
    odoo_skipped: !!odooResult?.skipped
  }
}

// Sincroniza el pago de una cuota a Odoo bajo demanda. No lanza: devuelve el
// objeto { success, ... } tal cual el flujo legacy.
export async function syncInstallmentPaymentToOdoo ({ enrollmentId, installmentNumber }) {
  return repo.syncInstallmentPaymentToOdoo({ enrollmentId, installmentNumber })
}
