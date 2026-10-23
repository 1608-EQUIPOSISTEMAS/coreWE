import { describe, it, expect } from 'vitest'
import { DomainError } from '../../../shared/errors.js'
import { parsePeriodo, tipoPago, lineaNegocio, grupoDe, toDetalle, buildResumen } from '../ingresos-operativos.entity.js'

const pago = (extra = {}) => ({
  payment_id: 1,
  enrollment_id: 10,
  fecha_pago: '2026-10-05',
  monto: '100.00',
  payment_type_id: 3115,
  currency_id: 3041,
  installment_number: 1,
  min_number: 1,
  total_installments: 1,
  business_line_id: 3225,
  type_program_id: 2503,
  modality_id: 2624,
  ...extra
})

describe('parsePeriodo', () => {
  it('un mes da el rango [inicio, inicio del siguiente)', () => {
    expect(parsePeriodo({ desde: '2026-10' })).toEqual({ desde: '2026-10', hasta: '2026-10', inicio: '2026-10-01', fin: '2026-11-01' })
  })
  it('cruza el año', () => {
    expect(parsePeriodo({ desde: '2026-11', hasta: '2027-01' }).fin).toBe('2027-02-01')
  })
  it('rechaza formato, meses antes de abril 2026, rango invertido y más de 12 meses', () => {
    expect(() => parsePeriodo({ desde: '2026-13' })).toThrow(DomainError)
    expect(() => parsePeriodo({ desde: '2026-03' })).toThrow(/abril 2026/)
    expect(() => parsePeriodo({ desde: '2026-10', hasta: '2026-09' })).toThrow(DomainError)
    expect(() => parsePeriodo({ desde: '2026-04', hasta: '2027-04' })).toThrow(/12 meses/)
    expect(parsePeriodo({ desde: '2026-04', hasta: '2027-03' }).fin).toBe('2027-04-01')
  })
})

describe('tipoPago', () => {
  const CONTADO = 'we_payment_way_single'
  const CUOTAS = 'we_payment_way_installments'
  it('monto 0 o inscripción de total 0 es BECA', () => {
    expect(tipoPago(pago({ monto: '0.00' }))).toBe('BECA')
    expect(tipoPago(pago({ enrollment_total: '0.00', payment_plan: CONTADO }))).toBe('BECA')
  })
  it('forma de pago contado es PT aunque el cronograma tenga varias cuotas', () => {
    expect(tipoPago(pago({ payment_plan: CONTADO, total_installments: 2, installment_number: 2 }))).toBe('PT')
  })
  it('en cuotas: la primera es PP, sea la 0 o la 1', () => {
    expect(tipoPago(pago({ payment_plan: CUOTAS, installment_number: 0, min_number: 0, total_installments: 3 }))).toBe('PP')
    expect(tipoPago(pago({ payment_plan: CUOTAS, total_installments: 3 }))).toBe('PP')
  })
  it('en cuotas: las siguientes son CUOTA aunque cat_payment_type diga contado', () => {
    expect(tipoPago(pago({ payment_plan: CUOTAS, installment_number: 1, min_number: 0, total_installments: 3, payment_type_id: 3115 }))).toBe('CUOTA')
  })
  it('sin forma de pago cargada se deduce del cronograma', () => {
    expect(tipoPago(pago())).toBe('PT')
    expect(tipoPago(pago({ installment_number: 2, total_installments: 3 }))).toBe('CUOTA')
  })
  it('certificado sin cuota es ADICIONAL, también en una beca', () => {
    expect(tipoPago(pago({ installment_number: null, payment_type_id: 5061, enrollment_total: '0' }))).toBe('ADICIONAL')
  })
})

describe('lineaNegocio', () => {
  it('usa la linea del programa', () => {
    expect(lineaNegocio(pago({ business_line_id: 3226 }))).toBe('ONLINE')
    expect(lineaNegocio(pago({ business_line_id: 3227 }))).toBe('FUNDACIÓN')
  })
  it('sin linea: congreso a Fundación y el resto por modalidad', () => {
    expect(lineaNegocio(pago({ business_line_id: null, type_program_id: 2507 }))).toBe('FUNDACIÓN')
    expect(lineaNegocio(pago({ business_line_id: null, modality_id: 2623 }))).toBe('ONLINE')
    expect(lineaNegocio(pago({ business_line_id: 5043, modality_id: 2624 }))).toBe('EN VIVO')
  })
})

describe('grupoDe', () => {
  it('EN VIVO separa ventas (PT, PP, BECA) de cuotas; ONLINE lleva todo', () => {
    expect(grupoDe('EN VIVO', 'PT')).toBe('EN_VIVO_VENTAS')
    expect(grupoDe('EN VIVO', 'PP')).toBe('EN_VIVO_VENTAS')
    expect(grupoDe('EN VIVO', 'CUOTA')).toBe('EN_VIVO_CUOTAS')
    expect(grupoDe('ONLINE', 'CUOTA')).toBe('ONLINE')
    expect(grupoDe('FUNDACIÓN', 'PT')).toBe('FUNDACION')
    expect(grupoDe('EN VIVO', 'ADICIONAL')).toBe('EXTRAS')
  })
})

describe('buildResumen', () => {
  it('suma por grupo y moneda, convierte a soles y saca la participación', () => {
    const detalle = [
      pago({ monto: '300' }),
      pago({ monto: '100', currency_id: 3042 }),
      pago({ monto: '200', business_line_id: 3226 })
    ].map(toDetalle)
    const r = buildResumen(detalle, 4)
    const ventas = r.filas.find(f => f.id === 'EN_VIVO_VENTAS')
    expect(ventas).toMatchObject({ pen: 300, usd: 100, soles: 700, pagos: 2 })
    expect(r.filas.find(f => f.id === 'ONLINE').pct).toBe(22.22)
    expect(r.total).toEqual({ pen: 500, usd: 100, soles: 900, pagos: 3 })
  })
  it('sin pagos da ceros, no NaN', () => {
    const r = buildResumen([])
    expect(r.total.soles).toBe(0)
    expect(r.filas.every(f => f.pct === 0)).toBe(true)
  })
})
