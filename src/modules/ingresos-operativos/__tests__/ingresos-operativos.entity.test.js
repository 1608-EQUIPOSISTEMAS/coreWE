import { describe, it, expect } from 'vitest'
import { DomainError } from '../../../shared/errors.js'
import { parsePeriodo, tipoPago, lineaNegocio, grupoDe, toDetalle, toDetalles, toDetalleAdicional, buildResumen } from '../ingresos-operativos.entity.js'

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
  it('monto 0 del canal AUS es auspicio, no beca', () => {
    expect(tipoPago(pago({ monto: '0.00', agent_origin: 'AUS' }))).toBe('AUS')
    expect(tipoPago(pago({ enrollment_total: '0.00', agent_origin: 'AUS' }))).toBe('AUS')
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

describe('toDetalleAdicional', () => {
  const adic = (extra = {}) => ({
    additional_payment_id: 1250,
    fecha_pago: '2026-06-25',
    monto: '50.00',
    currency: 'PEN',
    business_line: 'FUNDACIÓN WE',
    program: 'GEST. ÁGIL PROYECT',
    subject: 'Reprog.',
    full_name: 'TORRES LEZMA BRYAN',
    status: 'EFECTUADO',
    ...extra
  })
  it('suma a Pagos extras como ADICIONAL, sea cual sea la línea', () => {
    const d = toDetalleAdicional(adic())
    expect(d).toMatchObject({
      paymentId: -1250, additionalPaymentId: 1250, tipoPago: 'ADICIONAL', grupo: 'EXTRAS',
      lineaNegocio: 'FUNDACIÓN', tipoPrograma: 'ADICIONALES', curso: 'GEST. ÁGIL PROYECT', monto: 50, moneda: 'PEN'
    })
  })
  it('entra en el resumen junto con los pagos de inscripción', () => {
    const r = buildResumen([toDetalle(pago({ payment_type_id: 5061, installment_number: null })), toDetalleAdicional(adic({ currency: 'USD', monto: '14' }))], 4)
    expect(r.filas.find(f => f.id === 'EXTRAS')).toMatchObject({ pen: 100, usd: 14, soles: 156, pagos: 2 })
  })
})

describe('toDetalles: membresías GOLD y BLACK partidas como el sheet', () => {
  const CONTADO = 'we_payment_way_single'
  const CUOTAS = 'we_payment_way_installments'
  const memb = (extra = {}) => pago({ business_line_id: 3226, version_code: 'MEMB-04', payment_plan: CONTADO, ...extra })
  const corto = filas => filas.map(f => [f.lineaNegocio, f.tipoPago, f.monto, f.grupo])

  it('venta al contado: 250 a ONLINE y el resto a EN VIVO', () => {
    expect(corto(toDetalles(memb({ monto: '1900.00', version_code: 'MEMB-04' })))).toEqual([
      ['ONLINE', 'PT', 250, 'ONLINE'], ['EN VIVO', 'PT', 1650, 'EN_VIVO_VENTAS']
    ])
    expect(corto(toDetalles(memb({ monto: '650.00', version_code: 'MEMB-02' })))).toEqual([
      ['ONLINE', 'PT', 250, 'ONLINE'], ['EN VIVO', 'PT', 400, 'EN_VIVO_VENTAS']
    ])
  })
  it('inicial en cuotas: la parte ONLINE va como PT y la de Zoom como PP', () => {
    const pp = { payment_plan: CUOTAS, installment_number: 0, min_number: 0, total_installments: 4 }
    expect(corto(toDetalles(memb({ ...pp, monto: '390.00' })))).toEqual([
      ['ONLINE', 'PT', 250, 'ONLINE'], ['EN VIVO', 'PP', 140, 'EN_VIVO_VENTAS']
    ])
    // inicial menor que el tope: todo a ONLINE, sin fila en 0
    expect(corto(toDetalles(memb({ ...pp, monto: '200.00', version_code: 'MEMB-02' })))).toEqual([['ONLINE', 'PT', 200, 'ONLINE']])
  })
  it('las cuotas van enteras a EN VIVO', () => {
    const c = { payment_plan: CUOTAS, installment_number: 3, min_number: 0, total_installments: 6, monto: '277.00' }
    expect(corto(toDetalles(memb(c)))).toEqual([['EN VIVO', 'CUOTA', 277, 'EN_VIVO_CUOTAS']])
  })
  it('en dólares el tope ONLINE es US$ 75', () => {
    expect(corto(toDetalles(memb({ monto: '53.00', currency_id: 3042, version_code: 'MEMB-02' })))).toEqual([['ONLINE', 'PT', 53, 'ONLINE']])
    expect(corto(toDetalles(memb({ monto: '746.00', currency_id: 3042 })))).toEqual([
      ['ONLINE', 'PT', 75, 'ONLINE'], ['EN VIVO', 'PT', 671, 'EN_VIVO_VENTAS']
    ])
  })
  it('WE PLUS, becas y cursos quedan en una sola fila', () => {
    expect(toDetalles(memb({ version_code: 'MEMB-01', monto: '180.00' }))).toHaveLength(1)
    expect(toDetalles(memb({ monto: '0.00' }))[0].tipoPago).toBe('BECA')
    expect(toDetalles(pago({ version_code: 'EX-CZ-01', monto: '900.00' }))).toHaveLength(1)
  })
  it('las dos mitades comparten paymentId y se distinguen por parte', () => {
    const [a, b] = toDetalles(memb({ monto: '390.00' }))
    expect([a.paymentId, b.paymentId]).toEqual([1, 1])
    expect([a.parte, b.parte]).toEqual(['ONLINE', 'EN VIVO'])
  })
})
