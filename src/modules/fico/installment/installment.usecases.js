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
  validateCampaign,
  summarizeOdooError,
  buildRescheduleAuditDetails,
  buildCampaignAuditDetails,
  CAT_STATUS_ANNULLED,
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

// Pago adicional de becado (certificado): registra el pago suelto (sin cuota),
// promueve enrollments.cat_certificate_status a "Pagado e incluido" (la
// etiqueta "Certificar" del panel) y audita. Sin correo ni sync Odoo: el
// certificado no es parte del plan de pagos del programa.
export async function registerAdditionalPayment ({ enrollmentId, amount, catCurrency, catPaymentMedium, bankAccountId, transactionCode, voucherUrl, paymentDate, userId }) {
  const amt = Number(amount)
  if (!Number.isFinite(amt) || amt <= 0) throw new DomainError('Monto invalido')

  const enrollment = await repo.findActiveEnrollment(enrollmentId)
  if (!enrollment) throw new DomainError('Inscripcion no encontrada')

  const catPaymentType = await repo.findCatalogIdByAlias('we_payment_type_certificate')
  if (!catPaymentType) throw new DomainError('Catalogo we_payment_type_certificate no encontrado')
  const certPaidCatalogId = await repo.findCatalogIdByAlias('we_certificate_status_paid')
  if (!certPaidCatalogId) throw new DomainError('Catalogo we_certificate_status_paid no encontrado')

  const paidAt = paymentDate ? new Date(paymentDate) : new Date()

  await repo.registerAdditionalPaymentTx({
    enrollmentId,
    amount: amt,
    paidAt,
    transactionCode,
    catPaymentMedium,
    bankAccountId,
    voucherUrl,
    catCurrency,
    catPaymentType,
    certPaidCatalogId,
    userId
  })

  const methodLabel = await repo.findCatalogDescription(catPaymentMedium)
  const accountLabel = await repo.findBankAccountLabel(bankAccountId)
  await repo.logAudit({
    enrollmentId,
    action: 'additional_payment',
    userId,
    details: [
      `Pago de certificado registrado: ${fmtMoney(amt)}`,
      methodLabel,
      accountLabel,
      transactionCode ? `Op: ${transactionCode}` : null,
      paymentDate ? `Fecha: ${fmtFecha(paymentDate)}` : null,
      voucherUrl ? 'con voucher' : 'sin voucher'
    ].filter(Boolean).join(' · ') + '. Etiqueta Certificar activada.'
  })

  return { result: 1, message: 'Pago adicional registrado' }
}

// Edita el pago de certificado ya registrado (solo becados, nav Adicionales).
// Exige justificacion y audita el diff old -> new en el historial.
export async function editAdditionalPayment ({ enrollmentId, paymentId, amount, catCurrency, catPaymentMedium, bankAccountId, transactionCode, voucherUrl, paymentDate, justificacion, userId }) {
  if (!justificacion || !justificacion.trim()) throw new DomainError('Justificacion obligatoria')
  const amt = Number(amount)
  if (!Number.isFinite(amt) || amt <= 0) throw new DomainError('Monto invalido')

  const current = await repo.findCertificatePayment(paymentId, enrollmentId)
  if (!current) throw new DomainError('Pago de certificado no encontrado')

  const paidAt = paymentDate ? new Date(paymentDate) : new Date(current.payment_date)
  const newMethodLabel = await repo.findCatalogDescription(catPaymentMedium)
  const newAccountLabel = await repo.findBankAccountLabel(bankAccountId)
  const oldAccountLabel = [current.bank_name, current.account_number].filter(Boolean).join(' - ') || '---'
  const oldDate = current.payment_date ? new Date(current.payment_date).toISOString().slice(0, 10) : null

  const changes = {}
  if (Number(current.amount) !== amt) changes['Monto'] = { old: fmtMoney(current.amount), new: fmtMoney(amt) }
  if ((current.cat_method_payment || null) !== (catPaymentMedium || null)) changes['Medio de pago'] = { old: current.payment_method_label || '---', new: newMethodLabel || '---' }
  if ((current.settled_in_account_id || null) !== (bankAccountId || null)) changes['Cuenta bancaria'] = { old: oldAccountLabel, new: newAccountLabel || '---' }
  if ((current.transaction_code || '') !== (transactionCode || '')) changes['N. Operacion'] = { old: current.transaction_code || '---', new: transactionCode || '---' }
  if (paymentDate && oldDate !== paymentDate) changes['Fecha de pago'] = { old: oldDate ? fmtFecha(oldDate) : '---', new: fmtFecha(paymentDate) }
  if ((current.evidence_url || null) !== (voucherUrl || null)) changes['Voucher'] = { old: current.evidence_url ? 'Adjunto' : '---', new: voucherUrl ? 'Adjunto (nuevo)' : '---' }

  await repo.updateAdditionalPaymentTx({
    paymentId,
    enrollmentId,
    amount: amt,
    paidAt,
    transactionCode,
    catPaymentMedium,
    bankAccountId,
    voucherUrl,
    catCurrency
  })

  await repo.logAudit({
    enrollmentId,
    action: 'additional_payment_edited',
    userId,
    justificacion: justificacion.trim(),
    changes: Object.keys(changes).length ? changes : null,
    details: `Pago de certificado editado: ${fmtMoney(amt)}`
  })

  return { result: 1, message: 'Pago adicional actualizado' }
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

// Campaña de cobranza: paga cuotas en un solo pago consolidado (pagar las 5 de
// una, pagar 2 con el mismo voucher), anula cuotas y/o ajusta montos de las
// vivas. La cuota anulada NUNCA se borra: queda con estado Anulada, su monto y
// vencimiento originales, la causa en notes y el diff completo (quien, cuando,
// por que) en el audit log. Las pagadas comparten la misma data de pago
// (voucher, operacion, medio) — una fila en payments por cuota. La escritura
// es atomica; Odoo (write crudo sobre sale.order.fee) y el correo unico de
// confirmacion son best-effort.
export async function applyCollectionCampaign ({ enrollmentId, annulIds, adjustments, payIds, payment, payDiscount, payDiscountType, justificacion, reasonCode, userId }) {
  if (!justificacion || !justificacion.trim()) {
    throw new DomainError('La justificacion es obligatoria')
  }
  const pays = (payIds || []).map(Number).filter(Boolean)
  if (pays.length && !payment?.cat_payment_medium) {
    throw new DomainError('El medio de pago es obligatorio para registrar el pago consolidado')
  }

  const enrollment = await repo.findEnrollmentForReschedule(enrollmentId)
  if (!enrollment) throw new DomainError('Inscripcion no encontrada')

  const ids = [
    ...(annulIds || []).map(Number),
    ...(adjustments || []).map(a => Number(a.installment_id)),
    ...pays
  ].filter(Boolean)
  const currentInst = await repo.findInstallmentsByIds(enrollmentId, ids)
  const byId = new Map()
  for (const i of currentInst) byId.set(Number(i.installment_id), i)

  const { normalizedAnnuls, normalizedAdjusts, normalizedPays, auditDiff, annulledTotal, payTotal, paidTotal, payDiscount: discount, payDiscountPct, discountDelta } =
    validateCampaign(annulIds, adjustments, byId, pays, payDiscount, payDiscountType || 'amount')

  // Quien y cuando quedan en el audit log; la nota deja la causa en la fila.
  const annulNote = `Anulada por estrategia de cobranza (${justificacion.trim()})`

  await repo.applyCampaignTx({
    enrollmentId,
    annuls: normalizedAnnuls,
    adjusts: normalizedAdjusts,
    pays: normalizedPays,
    payment: {
      paidAt: payment?.payment_date ? new Date(payment.payment_date) : new Date(),
      transactionCode: payment?.transaction_code || '',
      catPaymentMedium: payment?.cat_payment_medium || null,
      bankAccountId: payment?.bank_account_id || null,
      voucherUrl: payment?.voucher_url || null,
      catCurrency: payment?.cat_currency || null
    },
    discountDelta,
    annulledStatusId: CAT_STATUS_ANNULLED,
    annulNote,
    userId
  })

  let odooResult = { success: true, updated: 0, skipped: true }
  if (enrollment.odoo_order_id) {
    try {
      odooResult = await repo.updateOdooFees(enrollment.odoo_order_id, [
        ...normalizedPays.map(p => ({
          seq: p.installment_number,
          values: {
            state: 'pagado',
            payment_state: 'saldado',
            ...(p.paid_amount !== p.amount ? { amount: p.paid_amount } : {})
          }
        })),
        ...normalizedAnnuls.map(a => ({ seq: a.installment_number, values: { state: 'anulado' } })),
        ...normalizedAdjusts.map(a => ({ seq: a.installment_number, values: { amount: a.new_amount } }))
      ])
      console.log('[applyCollectionCampaign] Odoo result:', JSON.stringify(odooResult))
    } catch (err) {
      console.error('[applyCollectionCampaign] Odoo sync exception:', err.message)
      odooResult = { success: false, error: err.message }
    }
  }

  const odooErrorSummary = summarizeOdooError(odooResult)
  await repo.logAudit({
    enrollmentId,
    action: 'collection_campaign',
    userId,
    justificacion: justificacion.trim(),
    changes: auditDiff,
    details: buildCampaignAuditDetails({
      reasonCode,
      annulCount: normalizedAnnuls.length,
      adjustCount: normalizedAdjusts.length,
      payCount: normalizedPays.length,
      paidTotal,
      payDiscount: discount,
      payDiscountPct,
      discountDelta,
      odooResult,
      hasOrder: !!enrollment.odoo_order_id,
      odooErrorSummary
    })
  })

  // Un solo correo de confirmacion por campaña (no uno por cuota pagada).
  let emailSent = false
  if (normalizedPays.length) {
    const emailResult = await safeAsync(
      '[applyCollectionCampaign][Email]',
      () => repo.sendPaymentConfirmationEmail({ enrollmentId })
    )
    emailSent = emailResult?.success === true
    await repo.logAudit({
      enrollmentId,
      action: emailSent ? 'email_sent' : 'email_failed',
      userId,
      details: emailSent
        ? `Correo confirmacion de pago consolidado (${normalizedPays.length} cuota(s)) enviado`
        : `Error al enviar correo de pago consolidado: ${emailResult?.error || 'desconocido'}`
    })
  }

  return {
    result: 1,
    message: 'Campaña de cobranza aplicada',
    paid: normalizedPays.length,
    paid_total: paidTotal,
    pay_discount: discount,
    annulled: normalizedAnnuls.length,
    adjusted: normalizedAdjusts.length,
    annulled_total: annulledTotal,
    discount_delta: discountDelta,
    email_sent: emailSent,
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

// Vista Cobranzas: cuotas pendientes con vencimiento en el mes pedido.
// Los KPIs se calculan sobre todo el mes (respetando q/dia/asesor) para que
// las pestañas del front muestren los conteos de los tres grupos aunque la
// tabla este filtrada por uno solo.
export async function getCollections ({ year, month, day = null, q = null, state = 'all', advisor_ids = [] } = {}) {
  const rows = await repo.listCollections({ year, month, day, q, advisorIds: advisor_ids })

  const kpis = {
    total_count: 0, total_amount: 0,
    overdue_count: 0, overdue_amount: 0,
    today_count: 0, today_amount: 0,
    upcoming_count: 0, upcoming_amount: 0
  }
  for (const r of rows) {
    const amt = Number(r.amount) || 0
    kpis.total_count++
    kpis.total_amount += amt
    kpis[`${r.state_label}_count`]++
    kpis[`${r.state_label}_amount`] += amt
  }

  const items = state === 'all' ? rows : rows.filter(r => r.state_label === state)
  return { items, kpis }
}
