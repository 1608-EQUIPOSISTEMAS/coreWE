import { describe, it, expect } from 'vitest'
import {
  firstWord,
  synthesizeOdooEmail,
  resolveConfirmationEmailMode,
  resolveProgramTypeLabel,
  resolvePaymentProgress,
  buildInstallmentsTableHTML,
  resolvePreviewActivationStart,
  resolveSendActivationStart,
  safeAttachmentName,
  isSinglePayment,
  SYNTHETIC_ODOO_DOMAIN
} from '../email-confirmation.entity.js'

describe('firstWord', () => {
  it('toma el primer token', () => {
    expect(firstWord('  Ana Maria  ')).toBe('Ana')
  })
  it('devuelve cadena vacia para nulos', () => {
    expect(firstWord(null)).toBe('')
    expect(firstWord('')).toBe('')
  })
})

describe('synthesizeOdooEmail', () => {
  it('construye apellido.nombre@dominio sintetico en minusculas', () => {
    expect(synthesizeOdooEmail('Ana Maria', 'Diaz Ruiz')).toBe(`diaz.ana${SYNTHETIC_ODOO_DOMAIN}`)
  })
})

describe('resolveConfirmationEmailMode', () => {
  it('alumno nuevo: primer envio y sin senales de retornante', () => {
    const r = resolveConfirmationEmailMode({
      isFirstSend: true,
      hasPriorEnrollment: false,
      odooEmail: `diaz.ana${SYNTHETIC_ODOO_DOMAIN}`
    })
    expect(r).toEqual({ isFirstSend: true, isReturningStudent: false, isNew: true })
  })

  it('retornante si tiene enrollment previo en Odoo', () => {
    const r = resolveConfirmationEmailMode({
      isFirstSend: true,
      hasPriorEnrollment: true,
      odooEmail: `diaz.ana${SYNTHETIC_ODOO_DOMAIN}`
    })
    expect(r.isReturningStudent).toBe(true)
    expect(r.isNew).toBe(false)
  })

  it('retornante si el odoo_email NO es del dominio sintetico', () => {
    const r = resolveConfirmationEmailMode({
      isFirstSend: true,
      hasPriorEnrollment: false,
      odooEmail: 'ana@gmail.com'
    })
    expect(r.isReturningStudent).toBe(true)
    expect(r.isNew).toBe(false)
  })

  it('no es nuevo si ya hubo un envio exitoso', () => {
    const r = resolveConfirmationEmailMode({
      isFirstSend: false,
      hasPriorEnrollment: false,
      odooEmail: `diaz.ana${SYNTHETIC_ODOO_DOMAIN}`
    })
    expect(r.isNew).toBe(false)
  })
})

describe('resolveProgramTypeLabel', () => {
  it('mapea las categorias conocidas', () => {
    expect(resolveProgramTypeLabel('ESP.')).toBe('Especializacion')
    expect(resolveProgramTypeLabel('especializacion')).toBe('Especializacion')
    expect(resolveProgramTypeLabel('DIPLOMADO')).toBe('Diplomado')
    expect(resolveProgramTypeLabel('pee')).toBe('PEE')
  })
  it('cae a "curso" para lo desconocido o vacio', () => {
    expect(resolveProgramTypeLabel('Otro')).toBe('curso')
    expect(resolveProgramTypeLabel(null)).toBe('curso')
  })
})

describe('resolvePaymentProgress', () => {
  const paid = n => ({ installment_number: n, status_alias: 'we_inst_paid', amount: 100, due_date: '2026-01-0' + n })
  const pending = n => ({ installment_number: n, status_alias: 'we_inst_pending', amount: 100, due_date: '2026-02-0' + n })

  it('marca pago completado cuando todas estan pagadas', () => {
    const r = resolvePaymentProgress([paid(1), paid(2)])
    expect(r.paidCount).toBe(2)
    expect(r.isLastPayment).toBe(true)
    expect(r.nextInstallment).toBeNull()
    expect(r.lastPaid.installment_number).toBe(2)
  })

  it('resuelve proxima pendiente y ultima pagada cuando hay mezcla', () => {
    const r = resolvePaymentProgress([paid(1), pending(2), pending(3)])
    expect(r.paidCount).toBe(1)
    expect(r.isLastPayment).toBe(false)
    expect(r.nextInstallment.installment_number).toBe(2)
    expect(r.lastPaid.installment_number).toBe(1)
  })

  it('lista vacia: no es ultimo pago', () => {
    const r = resolvePaymentProgress([])
    expect(r.isLastPayment).toBe(false)
    expect(r.paidCount).toBe(0)
  })
})

describe('buildInstallmentsTableHTML', () => {
  it('devuelve cadena vacia sin cuotas', () => {
    expect(buildInstallmentsTableHTML([], 'S/.')).toBe('')
  })
  it('renderiza fechas y montos truncados con el simbolo de moneda', () => {
    const html = buildInstallmentsTableHTML([{ due_date: '2026-03-15', amount: 250.99 }], 'US$')
    expect(html).toContain('CRONOGRAMA DE PAGOS')
    expect(html).toContain('15 Mar')
    expect(html).toContain('US$ 250')
  })
})

describe('resolvePreviewActivationStart', () => {
  const now = new Date('2026-05-29')
  it('prioriza activationDate valida (YYYY-MM-DD)', () => {
    const d = resolvePreviewActivationStart({ activationDate: '2026-08-01', persistedDate: '2026-01-01', editionStartDate: '2026-02-01', now })
    expect(d.toISOString().startsWith('2026-08-01')).toBe(true)
  })
  it('ignora activationDate mal formada y usa la persistida', () => {
    const d = resolvePreviewActivationStart({ activationDate: '01/08/2026', persistedDate: '2026-01-01', editionStartDate: '2026-02-01', now })
    expect(d.toISOString().startsWith('2026-01-01')).toBe(true)
  })
  it('cae a start_date de edicion y luego a hoy', () => {
    const d1 = resolvePreviewActivationStart({ activationDate: null, persistedDate: null, editionStartDate: '2026-02-01', now })
    expect(d1.toISOString().startsWith('2026-02-01')).toBe(true)
    const d2 = resolvePreviewActivationStart({ activationDate: null, persistedDate: null, editionStartDate: null, now })
    expect(d2).toBe(now)
  })
})

describe('resolveSendActivationStart', () => {
  const now = new Date('2026-05-29')
  it('prioriza persistida sobre edicion sobre hoy', () => {
    expect(resolveSendActivationStart({ persistedDate: '2026-01-01', editionStartDate: '2026-02-01', now }).toISOString().startsWith('2026-01-01')).toBe(true)
    expect(resolveSendActivationStart({ persistedDate: null, editionStartDate: '2026-02-01', now }).toISOString().startsWith('2026-02-01')).toBe(true)
    expect(resolveSendActivationStart({ persistedDate: null, editionStartDate: null, now })).toBe(now)
  })
})

describe('safeAttachmentName', () => {
  it('sanitiza caracteres no alfanumericos y recorta guiones de borde', () => {
    expect(safeAttachmentName('Diplomado: Gestion & Finanzas!')).toBe('Diplomado-Gestion-Finanzas')
  })
  it('usa el fallback cuando no hay nombre', () => {
    expect(safeAttachmentName(null)).toBe('Programa')
  })
})

describe('isSinglePayment', () => {
  it('detecta pago al contado', () => {
    expect(isSinglePayment('we_payment_way_single')).toBe(true)
    expect(isSinglePayment('we_payment_way_installments')).toBe(false)
  })
})
