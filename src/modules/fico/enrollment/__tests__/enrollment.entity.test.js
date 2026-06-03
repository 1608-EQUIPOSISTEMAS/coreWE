import { describe, it, expect } from 'vitest'
import { DomainError } from '../../../../shared/errors.js'
import {
  fmtAgent,
  composeAdvisorName,
  resolveProgramTypeLabel,
  flattenDailyKpis,
  resolveSellerAgentChange,
  assertChecked,
  editionShiftDays,
  buildDuplicateResponse,
  buildDirectInscription,
  buildCourseChangeInscription,
  courseChangeAmountDifference,
  PAID_INSTALLMENT_CAT_IDS
} from '../enrollment.entity.js'

describe('fmtAgent', () => {
  it('compone origin - alias cuando ambos existen', () => {
    expect(fmtAgent('AE30', 'B2B')).toBe('B2B - AE30')
  })
  it('usa solo alias o solo origin', () => {
    expect(fmtAgent('AE30', null)).toBe('AE30')
    expect(fmtAgent(null, 'WEB')).toBe('WEB')
  })
  it('placeholder cuando no hay nada', () => {
    expect(fmtAgent(null, null)).toBe('(sin asesor)')
  })
})

describe('composeAdvisorName', () => {
  it('mismo CASE WHEN que el SP del listado', () => {
    expect(composeAdvisorName('B2B', 'AE30')).toBe('B2B - AE30')
    expect(composeAdvisorName('WEB', null)).toBe('WEB')
    expect(composeAdvisorName(null, 'AE30')).toBe('AE30')
    expect(composeAdvisorName(null, null)).toBeNull()
  })
})

describe('resolveProgramTypeLabel', () => {
  it('clasifica por substring', () => {
    expect(resolveProgramTypeLabel('ESP Marketing')).toBe('ESP')
    expect(resolveProgramTypeLabel('Diplomado X')).toBe('Diplomado')
    expect(resolveProgramTypeLabel('PEE Finanzas')).toBe('PEE')
    expect(resolveProgramTypeLabel('Curso suelto')).toBe('Curso')
    expect(resolveProgramTypeLabel(null)).toBe('Curso')
  })
})

describe('flattenDailyKpis', () => {
  it('aplana filas a { today, yesterday }', () => {
    const out = flattenDailyKpis([
      { day_label: 'today', total: '5', confirmed: '3', pending: '2', amount: '100' },
      { day_label: 'yesterday', total: '4', confirmed: '4', pending: '0', amount: '80' }
    ])
    expect(out.today).toEqual({ total: 5, confirmed: 3, pending: 2, amount: 100 })
    expect(out.yesterday).toEqual({ total: 4, confirmed: 4, pending: 0, amount: 80 })
  })
  it('deja null los buckets ausentes', () => {
    expect(flattenDailyKpis([])).toEqual({ today: null, yesterday: null })
  })
})

describe('resolveSellerAgentChange (legacy origin)', () => {
  it('sin asesor -> SA', () => {
    const r = resolveSellerAgentChange({ oldAgentId: 7, oldOrigin: null, newSellerAgentId: null, newAgentOrigin: undefined })
    expect(r).toEqual({ newAgentId: null, newOrigin: 'SA', isSinAsesor: true })
  })
  it('al volver de SA a un asesor real limpia el canal', () => {
    const r = resolveSellerAgentChange({ oldAgentId: null, oldOrigin: 'SA', newSellerAgentId: 7, newAgentOrigin: undefined })
    expect(r).toEqual({ newAgentId: 7, newOrigin: null, isSinAsesor: false })
  })
  it('preserva el canal cuando no es SA', () => {
    const r = resolveSellerAgentChange({ oldAgentId: 5, oldOrigin: 'B2B', newSellerAgentId: 7, newAgentOrigin: undefined })
    expect(r).toEqual({ newAgentId: 7, newOrigin: 'B2B', isSinAsesor: false })
  })
})

describe('resolveSellerAgentChange (origin explicito)', () => {
  it('persiste el canal recibido tal cual', () => {
    const r = resolveSellerAgentChange({ oldAgentId: 5, oldOrigin: null, newSellerAgentId: 7, newAgentOrigin: 'WEB' })
    expect(r).toEqual({ newAgentId: 7, newOrigin: 'WEB', isSinAsesor: false })
  })
  it('cadena vacia / null = comercial sin canal', () => {
    const r = resolveSellerAgentChange({ oldAgentId: 5, oldOrigin: 'B2B', newSellerAgentId: 7, newAgentOrigin: '' })
    expect(r.newOrigin).toBeNull()
  })
  it('lanza si el canal y asesor son iguales a los actuales', () => {
    expect(() => resolveSellerAgentChange({ oldAgentId: 7, oldOrigin: 'B2B', newSellerAgentId: 7, newAgentOrigin: 'B2B' }))
      .toThrow(DomainError)
  })
})

describe('assertChecked', () => {
  it('pasa en estado checked', () => {
    expect(() => assertChecked('we_enrollment_status_checked')).not.toThrow()
  })
  it('lanza en cualquier otro estado', () => {
    expect(() => assertChecked('we_enrollment_status_observed')).toThrow(DomainError)
    expect(() => assertChecked(null)).toThrow(DomainError)
  })
})

describe('editionShiftDays', () => {
  it('calcula diferencia en dias', () => {
    expect(editionShiftDays('2026-01-01', '2026-01-11')).toBe(10)
    expect(editionShiftDays('2026-01-11', '2026-01-01')).toBe(-10)
  })
  it('devuelve 0 si falta una fecha', () => {
    expect(editionShiftDays(null, '2026-01-01')).toBe(0)
    expect(editionShiftDays('2026-01-01', null)).toBe(0)
  })
})

describe('buildDuplicateResponse', () => {
  it('compone quien y mensaje result=2', () => {
    const r = buildDuplicateResponse({
      enrollment_id: 99,
      existing_student_name: 'Ana Diaz',
      existing_document: '123',
      program_name: 'ESP X',
      edition_code: 'E01',
      seller_agent_alias: 'AE30',
      agent_origin: 'B2B',
      registration_date: '2026-01-01T00:00:00Z'
    })
    expect(r.result).toBe(2)
    expect(r.message).toContain('Ana Diaz')
    expect(r.message).toContain('AE30 - B2B')
    expect(r.duplicate_info.registered_by).toBe('AE30 - B2B')
  })
  it('fallback otro asesor sin alias/origin', () => {
    const r = buildDuplicateResponse({ enrollment_id: 1, existing_student_name: null, program_name: null })
    expect(r.duplicate_info.registered_by).toBe('otro asesor')
  })
})

describe('buildDirectInscription', () => {
  it('normaliza arrays y flags', () => {
    const insc = buildDirectInscription({
      document_number: '123', first_name: 'Ana', is_scholarship: true,
      dsct_benefit_ids: [1, 2], ticket_payment_urls: null
    })
    expect(insc.is_scholarship).toBe(true)
    expect(insc.dsct_benefit_ids).toEqual([1, 2])
    expect(insc.ticket_payment_urls).toEqual([])
    expect(insc.observations).toBe('Registro directo FICO')
  })
  it('is_scholarship solo true si === true', () => {
    expect(buildDirectInscription({ is_scholarship: 'yes' }).is_scholarship).toBe(false)
  })
})

describe('buildCourseChangeInscription', () => {
  const old = {
    document_number: '123', cat_type_document: 1, first_name: 'Ana', last_name: 'Diaz',
    origin_email: 'a@x.com', origin_phone: '999', cat_inscription_modality: 5,
    cat_payment_channel: 2, cat_currency: 10, cat_payment_plan: 20
  }
  it('fija Sin Asesor (SA) en la nueva venta', () => {
    const insc = buildCourseChangeInscription({
      old, newProgramVersionId: 200, newEditionId: 300, totalAmount: 500,
      ccNote: 'CC #1', ccContadoCatId: 99, resolvedMethodPayment: 7, today: '2026-05-29'
    })
    expect(insc.seller_agent_id).toBeNull()
    expect(insc.agent_origin).toBe('SA')
    expect(insc.program_version_id).toBe(200)
    expect(insc.program_edition_id).toBe(300)
    expect(insc.total_amount).toBe(500)
    expect(insc.cat_payment_way).toBe(99)
    expect(insc.cat_payment_medium).toBe(7)
    expect(insc.payment_date).toBe('2026-05-29')
    expect(insc.is_scholarship).toBe(false)
  })
  it('respeta overrides de moneda y metodo', () => {
    const insc = buildCourseChangeInscription({
      old, newProgramVersionId: 1, newEditionId: 2, totalAmount: 100,
      ccNote: 'x', cat_currency: 55, cat_method_payment: 88,
      ccContadoCatId: null, resolvedMethodPayment: 7, today: '2026-05-29'
    })
    expect(insc.cat_currency).toBe(55)
    expect(insc.cat_payment_medium).toBe(88)
    expect(insc.cat_payment_way).toBe(20)
  })
})

describe('courseChangeAmountDifference', () => {
  it('neto = total - descuento; diferencia = nuevo - viejo', () => {
    const r = courseChangeAmountDifference(1000, 200, 1200)
    expect(r.oldAmount).toBe(800)
    expect(r.amountDifference).toBe(400)
  })
})

describe('PAID_INSTALLMENT_CAT_IDS', () => {
  it('incluye ambos namespaces de cuota saldada', () => {
    expect(PAID_INSTALLMENT_CAT_IDS).toEqual([4454, 2471])
  })
})
