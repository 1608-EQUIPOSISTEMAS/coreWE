import { describe, it, expect } from 'vitest'
import { DomainError } from '../../../shared/errors.js'
import { parsePeriodo, buildPago, toFila, esCertificado, ASUNTOS, TIPO_PROGRAMA } from '../pagos-adicionales.entity.js'

const input = (extra = {}) => ({
  business_line: 'EN VIVO',
  program: 'SAP HANA MM',
  subject: 'Reprog.',
  payment_date: '2026-10-18',
  full_name: '  CHRISTIAN CUEVA  ',
  phone: '941421778',
  email: 'christian@gmail.com',
  amount: 70,
  currency: 'PEN',
  ...extra
})

const cuenta = { account_id: 6, business_entity_catalog_id: 3213, bank_name: 'BCP', currency: 'PEN' }

describe('parsePeriodo', () => {
  it('un mes', () => {
    expect(parsePeriodo({ desde: '2026-10' })).toEqual({ desde: '2026-10', hasta: '2026-10', inicio: '2026-10-01', fin: '2026-11-01' })
  })
  it('diciembre cierra en enero del año siguiente', () => {
    expect(parsePeriodo({ desde: '2026-01', hasta: '2026-12' }).fin).toBe('2027-01-01')
  })
  it('rechaza meses antes de 2026, rangos al revés y de más de 12 meses', () => {
    expect(() => parsePeriodo({ desde: '2025-12' })).toThrow(DomainError)
    expect(() => parsePeriodo({ desde: '2026-05', hasta: '2026-04' })).toThrow(/anterior/)
    expect(() => parsePeriodo({ desde: '2026-01', hasta: '2027-01' })).toThrow(/12 meses/)
    expect(() => parsePeriodo({ desde: '2026-1' })).toThrow(/AAAA-MM/)
  })
})

describe('buildPago', () => {
  it('normaliza textos y aplica los valores por defecto', () => {
    const p = buildPago(input({ phone: '', transaction_code: ' 10566940 ' }))
    expect(p).toMatchObject({ full_name: 'CHRISTIAN CUEVA', phone: null, status: 'EFECTUADO', done: false, transaction_code: '10566940', amount: 70 })
  })

  it('lista los campos obligatorios que faltan', () => {
    expect(() => buildPago(input({ program: ' ', full_name: '' }))).toThrow('Falta: Programa, Nombres y apellidos')
  })

  it('valida línea, estado, moneda, fecha, monto y correo', () => {
    expect(() => buildPago(input({ business_line: 'B2B' }))).toThrow(/Línea/)
    expect(() => buildPago(input({ status: 'ANULADO' }))).toThrow(/Estado/)
    expect(() => buildPago(input({ currency: 'EUR' }))).toThrow(/Moneda/)
    expect(() => buildPago(input({ payment_date: '2026-02-30' }))).toThrow(/F. pago/)
    expect(() => buildPago(input({ payment_date: '2025-12-31' }))).toThrow(/enero 2026/)
    expect(() => buildPago(input({ amount: -1 }))).toThrow(/Monto/)
    expect(() => buildPago(input({ email: 'PAGO NO IDENTIFICADO' }))).toThrow(/Correo/)
  })

  it('rechaza los certificados: van en FICO > Inscripciones', () => {
    for (const a of ['Cert. becas', 'Dup. Cert', 'Conv. Cert.', 'Cert. congreso']) {
      expect(() => buildPago(input({ subject: a }))).toThrow(/Inscripciones/)
    }
    expect(ASUNTOS.some(esCertificado)).toBe(false)
    expect(esCertificado('Const. Curso')).toBe(false)
    expect(esCertificado('Reprog.')).toBe(false)
  })

  it('el asunto tiene que ser uno de la lista del sheet', () => {
    expect(() => buildPago(input({ subject: 'REASIGNACIÓN' }))).toThrow(/Asunto no válido/)
    expect(buildPago(input({ subject: 'Visita Tecnica' })).subject).toBe('Visita Tecnica')
  })

  it('redondea el monto a 2 decimales y acepta monto 0', () => {
    expect(buildPago(input({ amount: 49.999 })).amount).toBe(50)
    expect(buildPago(input({ amount: 0 })).amount).toBe(0)
  })

  it('la cuenta tiene que existir, ser de la empresa y de la moneda del pago', () => {
    expect(() => buildPago(input({ bank_account_id: 6, cat_business_entity: 3213 }))).toThrow(/no existe/)
    expect(() => buildPago(input({ bank_account_id: 6, cat_business_entity: 3215 }), { cuenta })).toThrow(/entidad empresa/)
    expect(() => buildPago(input({ bank_account_id: 6, cat_business_entity: 3213, currency: 'USD' }), { cuenta })).toThrow(/en PEN/)
  })

  it('sin empresa elegida la toma de la cuenta', () => {
    expect(buildPago(input({ bank_account_id: 6 }), { cuenta }).cat_business_entity).toBe(3213)
  })
})

describe('toFila', () => {
  it('arma la fila con las columnas del sheet', () => {
    const f = toFila({
      additional_payment_id: 7, business_line: 'EN VIVO', program: 'SAP HANA MM', subject: 'Reprog.', payment_date: '2026-10-18',
      full_name: 'X', phone: null, email: null, status: 'EFECTUADO', done: true, amount: '70.00', currency: 'PEN',
      medio_pago: 'YAPE', empresa_alias: 'we_business_entity_weee', empresa: 'WE EDUCACION EJECUTIVA S.A.C.', banco: 'BCP',
      transaction_code: null, product_line: 'SAP', payment_type: null
    })
    expect(f).toMatchObject({
      id: 7, celular: '', realizado: true, monto: 70, medioPago: 'YAPE', entidadEmpresa: 'WE Educación',
      entidadFinanciera: 'BCP', nOper: '', tipoPrograma: TIPO_PROGRAMA, lineaProducto: 'SAP', tipoPago: ''
    })
  })
  it('empresa sin nombre corto: usa la descripción del catálogo', () => {
    expect(toFila({ amount: 1, empresa_alias: 'otra', empresa: 'OTRA SAC' }).entidadEmpresa).toBe('OTRA SAC')
  })
})
