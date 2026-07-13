import { describe, it, expect } from 'vitest'
import { DomainError } from '../../../../shared/errors.js'
import {
  isPaidByAlias,
  isPaidByCatStatus,
  assertEditableAmount,
  assertAddAmount,
  normalizeDueDate,
  nextInstallmentNumber,
  validateReschedule,
  validateCampaign,
  summarizeOdooError,
  buildRescheduleAuditDetails,
  buildCampaignAuditDetails,
  fmtMoney,
  fmtFecha,
  PAID_STATUS_IDS,
  CAT_STATUS_PAID,
  CAT_STATUS_ANNULLED
} from '../installment.entity.js'

// Fila de payment_installments valida (pendiente, editable). Cada test rompe un
// solo campo para aislar la regla bajo prueba.
const instRow = (over = {}) => ({
  installment_id: 10,
  installment_number: 2,
  amount: 300,
  enrollment_id: 99,
  due_date: '2026-06-01',
  cat_status: 3174,
  status_alias: 'we_inst_pending',
  ...over
})

describe('deteccion de cuota pagada', () => {
  it('reconoce ambos namespaces por alias', () => {
    expect(isPaidByAlias('we_inst_paid')).toBe(true)
    expect(isPaidByAlias('we_payment_status_paid')).toBe(true)
    expect(isPaidByAlias('we_inst_pending')).toBe(false)
    expect(isPaidByAlias(null)).toBe(false)
  })

  it('reconoce ambos namespaces por id de catalogo', () => {
    expect(isPaidByCatStatus(4454)).toBe(true)
    expect(isPaidByCatStatus(2471)).toBe(true)
    expect(isPaidByCatStatus('4454')).toBe(true)
    expect(isPaidByCatStatus(3174)).toBe(false)
  })

  it('CAT_STATUS_PAID es el hardcode legacy 4454 y esta en el set', () => {
    expect(CAT_STATUS_PAID).toBe(4454)
    expect(PAID_STATUS_IDS.has(4454)).toBe(true)
  })
})

describe('assertEditableAmount', () => {
  it('rechaza monto no positivo o invalido', () => {
    expect(() => assertEditableAmount(instRow(), 0)).toThrow(DomainError)
    expect(() => assertEditableAmount(instRow(), -5)).toThrow('Monto invalido')
    expect(() => assertEditableAmount(instRow(), 'abc')).toThrow('Monto invalido')
  })

  it('rechaza cuota inexistente', () => {
    expect(() => assertEditableAmount(null, 100)).toThrow('Cuota no encontrada para esta inscripcion')
  })

  it('rechaza la fila inicial/reserva (installment_number 0)', () => {
    expect(() => assertEditableAmount(instRow({ installment_number: 0 }), 100))
      .toThrow('Usa el flujo de pago inicial para esa fila')
  })

  it('rechaza editar una cuota ya pagada (cualquier namespace)', () => {
    expect(() => assertEditableAmount(instRow({ status_alias: 'we_inst_paid' }), 100))
      .toThrow('No se puede editar el monto de una cuota ya pagada')
    expect(() => assertEditableAmount(instRow({ status_alias: 'we_payment_status_paid' }), 100))
      .toThrow('No se puede editar el monto de una cuota ya pagada')
  })

  it('rechaza un monto identico al actual', () => {
    expect(() => assertEditableAmount(instRow({ amount: 300 }), 300))
      .toThrow('El monto nuevo es igual al actual')
  })

  it('devuelve montos normalizados cuando es valido', () => {
    expect(assertEditableAmount(instRow({ amount: 300 }), 450)).toEqual({ oldAmount: 300, newAmount: 450 })
  })
})

describe('assertAddAmount y normalizeDueDate', () => {
  it('valida monto positivo', () => {
    expect(assertAddAmount(120)).toBe(120)
    expect(() => assertAddAmount(0)).toThrow('Monto invalido')
  })

  it('exige fecha y formato ISO YYYY-MM-DD', () => {
    expect(() => normalizeDueDate(null)).toThrow('Fecha de vencimiento obligatoria')
    expect(() => normalizeDueDate('01/06/2026')).toThrow('Fecha invalida (formato YYYY-MM-DD)')
    expect(normalizeDueDate('2026-06-01T10:00:00Z')).toBe('2026-06-01')
  })
})

describe('nextInstallmentNumber', () => {
  it('es el maximo existente + 1', () => {
    expect(nextInstallmentNumber(3)).toBe(4)
    expect(nextInstallmentNumber(0)).toBe(1)
    expect(nextInstallmentNumber(null)).toBe(1)
  })
})

describe('validateReschedule', () => {
  const mapOf = (...rows) => {
    const m = new Map()
    for (const r of rows) m.set(Number(r.installment_id), r)
    return m
  }

  it('rechaza una cuota que no pertenece a la inscripcion', () => {
    const byId = mapOf()
    expect(() => validateReschedule([{ installment_id: 5, new_due_date: '2026-07-01' }], byId, null))
      .toThrow('Cuota 5 no pertenece a la inscripcion')
  })

  it('rechaza reprogramar el pago inicial', () => {
    const byId = mapOf(instRow({ installment_id: 1, installment_number: 0 }))
    expect(() => validateReschedule([{ installment_id: 1, new_due_date: '2026-07-01' }], byId, null))
      .toThrow('El pago inicial no se reprograma')
  })

  it('rechaza una cuota ya pagada por cat_status', () => {
    const byId = mapOf(instRow({ installment_id: 2, cat_status: 2471 }))
    expect(() => validateReschedule([{ installment_id: 2, new_due_date: '2026-07-01' }], byId, null))
      .toThrow('La cuota 2 ya esta pagada')
  })

  it('permite adelantar la fecha (correccion de back-office)', () => {
    const byId = mapOf(instRow({ installment_id: 2, due_date: '2026-06-10' }))
    const { normalizedChanges } = validateReschedule([{ installment_id: 2, new_due_date: '2026-06-01' }], byId, null)
    expect(normalizedChanges[0].new_due_date).toBe('2026-06-01')
  })

  it('guarda la fecha exacta sin corrimiento de zona horaria', () => {
    const byId = mapOf(instRow({ installment_id: 2, due_date: '2026-06-10' }))
    const { normalizedChanges } = validateReschedule([{ installment_id: 2, new_due_date: '2026-06-20' }], byId, null)
    expect(normalizedChanges[0].new_due_date).toBe('2026-06-20')
  })

  it('no permite superar la fecha fin de la edicion', () => {
    const byId = mapOf(instRow({ installment_id: 2, due_date: '2026-06-01' }))
    const editionEnd = new Date('2026-06-15')
    expect(() => validateReschedule([{ installment_id: 2, new_due_date: '2026-06-30' }], byId, editionEnd))
      .toThrow(/no puede superar la fecha fin de la edicion/)
  })

  it('normaliza cambios validos y construye el diff de auditoria', () => {
    // Las fechas se comparan/serializan exactamente como en el legacy (Date +
    // setHours(0) + toISOString). El componente exacto depende del TZ del host,
    // por eso se valida la estructura y la consistencia entre normalizedChanges
    // y auditDiff, no un string de fecha hardcodeado.
    const byId = mapOf(instRow({ installment_id: 2, installment_number: 2, due_date: '2026-06-01' }))
    const { normalizedChanges, auditDiff } = validateReschedule(
      [{ installment_id: 2, new_due_date: '2026-06-20' }],
      byId,
      new Date('2026-12-31')
    )
    expect(normalizedChanges).toHaveLength(1)
    const ch = normalizedChanges[0]
    expect(ch.installment_id).toBe(2)
    expect(ch.installment_number).toBe(2)
    expect(ch.old_due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(ch.new_due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(ch.new_due_date) > new Date(ch.old_due_date)).toBe(true)
    expect(auditDiff).toEqual({ 'Cuota 2': { old: ch.old_due_date, new: ch.new_due_date } })
  })
})

describe('validateCampaign', () => {
  const mapOf = (...rows) => {
    const m = new Map()
    for (const r of rows) m.set(Number(r.installment_id), r)
    return m
  }

  it('exige al menos una operacion', () => {
    expect(() => validateCampaign([], [], mapOf())).toThrow('Debe anular, ajustar o pagar al menos una cuota')
  })

  it('pago consolidado: "pague las 5 de una" marca todas y suma el total', () => {
    const byId = mapOf(
      ...[1, 2, 3, 4, 5].map(n => instRow({ installment_id: n, installment_number: n, amount: 200 }))
    )
    const r = validateCampaign([], [], byId, [1, 2, 3, 4, 5])
    expect(r.normalizedPays).toHaveLength(5)
    expect(r.payTotal).toBe(1000)
    expect(r.discountDelta).toBe(0)
    expect(r.auditDiff['Cuota 1'].new).toBe('Pagada (pago consolidado de campaña)')
  })

  it('descuento de campaña sobre el pago: reparte proporcional y la suma es exacta', () => {
    // "No pagan 800, pagan 750": 4 cuotas de 200 con descuento 50.
    const byId = mapOf(
      ...[1, 2, 3, 4].map(n => instRow({ installment_id: n, installment_number: n, amount: 200 }))
    )
    const r = validateCampaign([], [], byId, [1, 2, 3, 4], 50)
    expect(r.paidTotal).toBe(750)
    expect(r.discountDelta).toBe(50)
    const suma = r.normalizedPays.reduce((s, p) => s + p.paid_amount, 0)
    expect(Math.round(suma * 100) / 100).toBe(750)
    expect(r.auditDiff['Cuota 1'].new).toMatch(/Pagada por S\/\. 187\.50 .*descuento/)
  })

  it('reparto con redondeo: la ultima cuota absorbe la diferencia', () => {
    // 3 cuotas de 100 con descuento 10: 90 + 90 + 90 = 270 exacto (30.00 c/u
    // seria 90.00, pero con montos que no dividen parejo igual debe cerrar).
    const byId = mapOf(
      ...[1, 2, 3].map(n => instRow({ installment_id: n, installment_number: n, amount: 33.33 }))
    )
    const r = validateCampaign([], [], byId, [1, 2, 3], 10)
    const suma = r.normalizedPays.reduce((s, p) => s + p.paid_amount, 0)
    expect(Math.round(suma * 100) / 100).toBe(Math.round((33.33 * 3 - 10) * 100) / 100)
  })

  it('descuento por porcentaje: 5% sobre el total a pagar, con rastro del %', () => {
    // El caso tipico de campaña: paga todo adelantado con 5% de descuento.
    const byId = mapOf(
      ...[1, 2, 3, 4].map(n => instRow({ installment_id: n, installment_number: n, amount: 200 }))
    )
    const r = validateCampaign([], [], byId, [1, 2, 3, 4], 5, 'percent')
    expect(r.payDiscount).toBe(40)
    expect(r.payDiscountPct).toBe(5)
    expect(r.paidTotal).toBe(760)
    const suma = r.normalizedPays.reduce((s, p) => s + p.paid_amount, 0)
    expect(Math.round(suma * 100) / 100).toBe(760)
    expect(() => validateCampaign([], [], byId, [1], 100, 'percent'))
      .toThrow('El porcentaje de descuento debe ser menor a 100')
  })

  it('rechaza descuento invalido o mayor/igual al total a pagar', () => {
    const byId = mapOf(instRow({ installment_id: 1, installment_number: 1, amount: 100 }))
    expect(() => validateCampaign([], [], byId, [1], -5)).toThrow('Descuento invalido')
    expect(() => validateCampaign([], [], byId, [1], 100))
      .toThrow('El descuento no puede ser mayor o igual al total de las cuotas a pagar')
    expect(() => validateCampaign([1], [], byId, [], 20))
      .toThrow('El descuento del pago requiere cuotas marcadas para pagar')
  })

  it('paga 2 y anula 2: combina acciones sin solaparse', () => {
    const byId = mapOf(
      ...[1, 2, 3, 4].map(n => instRow({ installment_id: n, installment_number: n, amount: 100 }))
    )
    const r = validateCampaign([3, 4], [], byId, [1, 2])
    expect(r.payTotal).toBe(200)
    expect(r.annulledTotal).toBe(200)
    expect(() => validateCampaign([1], [], byId, [1]))
      .toThrow('Una cuota no puede anularse y pagarse a la vez')
    expect(() => validateCampaign([], [{ installment_id: 1, new_amount: 50 }], byId, [1]))
      .toThrow('La cuota 1 no puede pagarse y ajustarse a la vez')
  })

  it('rechaza cuotas ajenas, pagadas, anuladas o la inicial', () => {
    const byId = mapOf(
      instRow({ installment_id: 1, installment_number: 0 }),
      instRow({ installment_id: 2, cat_status: 4454, installment_number: 2 }),
      instRow({ installment_id: 3, cat_status: CAT_STATUS_ANNULLED, installment_number: 3 })
    )
    expect(() => validateCampaign([99], [], byId)).toThrow('Cuota 99 no pertenece a la inscripcion')
    expect(() => validateCampaign([1], [], byId)).toThrow('El pago inicial no participa en campañas')
    expect(() => validateCampaign([2], [], byId)).toThrow('La cuota 2 ya esta pagada')
    expect(() => validateCampaign([3], [], byId)).toThrow('La cuota 3 ya esta anulada')
  })

  it('rechaza anular y ajustar la misma cuota, y montos invalidos', () => {
    const byId = mapOf(instRow({ installment_id: 5, installment_number: 2, amount: 200 }))
    expect(() => validateCampaign([5], [{ installment_id: 5, new_amount: 100 }], byId))
      .toThrow('no puede anularse y ajustarse a la vez')
    expect(() => validateCampaign([], [{ installment_id: 5, new_amount: 0 }], byId))
      .toThrow('Monto invalido para la cuota 2')
  })

  it('consolidacion total: lo anulado absorbido por los ajustes deja descuento 0', () => {
    // "Paga 2 y se anulan 2": las cuotas 3 y 4 se anulan y su plata pasa a 1 y 2.
    const byId = mapOf(
      instRow({ installment_id: 1, installment_number: 1, amount: 100 }),
      instRow({ installment_id: 2, installment_number: 2, amount: 100 }),
      instRow({ installment_id: 3, installment_number: 3, amount: 100 }),
      instRow({ installment_id: 4, installment_number: 4, amount: 100 })
    )
    const r = validateCampaign(
      [3, 4],
      [{ installment_id: 1, new_amount: 200 }, { installment_id: 2, new_amount: 200 }],
      byId
    )
    expect(r.annulledTotal).toBe(200)
    expect(r.discountDelta).toBe(0)
    expect(r.auditDiff['Cuota 3'].new).toBe('Anulada por estrategia de cobranza')
    expect(r.auditDiff['Cuota 1']).toEqual({ old: 'S/. 100.00', new: 'S/. 200.00' })
  })

  it('descuento por pago adelantado: la plata no absorbida es descuento', () => {
    // Anula 1 cuota de 100 y sube otra solo en 50: descuento de cobranza 50.
    const byId = mapOf(
      instRow({ installment_id: 1, installment_number: 1, amount: 100 }),
      instRow({ installment_id: 2, installment_number: 2, amount: 100 })
    )
    const r = validateCampaign([2], [{ installment_id: 1, new_amount: 150 }], byId)
    expect(r.discountDelta).toBe(50)
  })

  it('rebaja pura sin anular tambien es descuento', () => {
    const byId = mapOf(instRow({ installment_id: 1, installment_number: 1, amount: 100 }))
    const r = validateCampaign([], [{ installment_id: 1, new_amount: 95 }], byId)
    expect(r.annulledTotal).toBe(0)
    expect(r.discountDelta).toBe(5)
  })
})

describe('buildCampaignAuditDetails', () => {
  it('compone motivo, conteos, descuento y estado Odoo', () => {
    const d = buildCampaignAuditDetails({
      reasonCode: 'campana_cobranza', annulCount: 2, adjustCount: 1,
      discountDelta: 50, odooResult: { success: true }, hasOrder: true
    })
    expect(d).toBe('Motivo: Campaña de cobranza — 2 cuota(s) anulada(s) — 1 cuota(s) ajustada(s) — descuento por cobranza S/. 50.00 | Odoo: sincronizado')
  })

  it('omite partes vacias y refleja fallo de Odoo', () => {
    const d = buildCampaignAuditDetails({
      reasonCode: 'pago_adelantado', annulCount: 0, adjustCount: 2,
      discountDelta: 0, odooResult: { success: false }, hasOrder: true, odooErrorSummary: 'boom'
    })
    expect(d).toBe('Motivo: Descuento por pago adelantado — 2 cuota(s) ajustada(s) | Odoo: FALLO (boom)')
  })
})

describe('summarizeOdooError', () => {
  it('devuelve null cuando no hubo fallo', () => {
    expect(summarizeOdooError({ success: true })).toBeNull()
  })

  it('prioriza el campo error', () => {
    expect(summarizeOdooError({ success: false, error: 'boom' })).toBe('boom')
  })

  it('compone el resumen desde failed[]', () => {
    expect(summarizeOdooError({ success: false, failed: [{ seq: 2, error: 'x' }, { seq: 3, error: 'y' }] }))
      .toBe('Cuota 2: x; Cuota 3: y')
  })

  it('cae a un mensaje generico', () => {
    expect(summarizeOdooError({ success: false })).toBe('Error desconocido')
  })
})

describe('buildRescheduleAuditDetails', () => {
  it('refleja sincronizacion ok con orden', () => {
    const d = buildRescheduleAuditDetails({ reasonCode: 'financiero', count: 2, odooResult: { success: true }, hasOrder: true })
    expect(d).toBe('Motivo: Financiero — 2 cuota(s) reprogramada(s) | Odoo: sincronizado')
  })

  it('refleja ausencia de orden', () => {
    const d = buildRescheduleAuditDetails({ reasonCode: 'otro', count: 1, odooResult: { success: true, skipped: true }, hasOrder: false })
    expect(d).toBe('Motivo: Otro — 1 cuota(s) reprogramada(s) | Odoo: sin orden asociada')
  })

  it('refleja fallo de Odoo con el resumen de error', () => {
    const d = buildRescheduleAuditDetails({ reasonCode: 'academico', count: 1, odooResult: { success: false }, hasOrder: true, odooErrorSummary: 'boom' })
    expect(d).toBe('Motivo: Academico — 1 cuota(s) reprogramada(s) | Odoo: FALLO (boom)')
  })
})

describe('formateadores', () => {
  it('fmtMoney usa el simbolo de soles con dos decimales', () => {
    expect(fmtMoney(300)).toBe('S/. 300.00')
    expect(fmtMoney('45.5')).toBe('S/. 45.50')
  })

  it('fmtFecha invierte una fecha ISO a dd/mm/yyyy', () => {
    expect(fmtFecha('2026-06-01')).toBe('01/06/2026')
  })
})
