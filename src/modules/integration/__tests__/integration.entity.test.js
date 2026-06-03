import { describe, it, expect } from 'vitest'
import {
  serializeSheetValue,
  serializeSheetRow,
  buildSalesRow,
  buildAulaRow,
  buildConsolidadoRow,
  buildCuotasRow,
  buildCuotasHeaderRow,
  buildSlackEnrollmentBlocks
} from '../integration.entity.js'

describe('serializeSheetValue', () => {
  it('mapea null y undefined a string vacio', () => {
    expect(serializeSheetValue(null)).toBe('')
    expect(serializeSheetValue(undefined)).toBe('')
  })
  it('formatea Date a YYYY-MM-DD HH:MM:SS sin la T', () => {
    expect(serializeSheetValue(new Date('2026-05-29T13:45:09.000Z'))).toBe('2026-05-29 13:45:09')
  })
  it('convierte cualquier otro valor con String()', () => {
    expect(serializeSheetValue(0)).toBe('0')
    expect(serializeSheetValue(42)).toBe('42')
    expect(serializeSheetValue('hola')).toBe('hola')
    expect(serializeSheetValue(false)).toBe('false')
  })
})

describe('serializeSheetRow', () => {
  it('serializa una fila respetando el orden de las cabeceras', () => {
    const row = { a: 'x', b: null, c: 3 }
    expect(serializeSheetRow(row, ['a', 'b', 'c'])).toEqual(['x', '', '3'])
  })
  it('aplica formato de fecha por celda', () => {
    const row = { f: new Date('2026-01-02T00:00:00.000Z'), n: 5 }
    expect(serializeSheetRow(row, ['f', 'n'])).toEqual(['2026-01-02 00:00:00', '5'])
  })
})

describe('buildSalesRow', () => {
  it('produce 20 columnas A..T en orden', () => {
    const r = {
      cod: 'C1', ed: 'E0', f_inicio: '01/01/2026', f_pago: '02/01/2026',
      dni: '123', nombres: 'Ana', celular: '999', correo: 'a@b.c',
      ocup: 'P', asesor: 'WEB - x', estado: 'PT', dsct: '10,00%',
      al_dia: 'Al dia', inicial: '100', saldo: '0', ingreso: '100',
      tipo_cliente: 'N', estado_alumno: 'ACT', membresia: '', flex: 'FLEX'
    }
    const out = buildSalesRow(r)
    expect(out).toHaveLength(20)
    expect(out[0]).toBe('C1')
    expect(out[19]).toBe('FLEX')
  })
  it('rellena vacios con string vacio', () => {
    const out = buildSalesRow({})
    expect(out).toHaveLength(20)
    expect(out.every(c => c === '')).toBe(true)
  })
})

describe('buildAulaRow', () => {
  it('produce 16 columnas A..P', () => {
    expect(buildAulaRow({})).toHaveLength(16)
  })
})

describe('buildConsolidadoRow', () => {
  it('produce 31 columnas A..AE', () => {
    expect(buildConsolidadoRow({})).toHaveLength(31)
  })
})

describe('buildCuotasHeaderRow', () => {
  it('tiene 10 base + MAX*6 + MAX*2 columnas', () => {
    const MAX = 8
    const headers = buildCuotasHeaderRow(MAX)
    expect(headers).toHaveLength(10 + MAX * 6 + MAX * 2)
    expect(headers.slice(0, 10)).toEqual(['COD', 'ED', 'F. INICIO', 'NOMBRES Y APELLIDOS', 'CELULAR', 'CORREO', 'OCUP', 'AS', 'ESTADO', 'MONEDA'])
    expect(headers[10]).toBe('FC1')
  })
})

describe('buildCuotasRow', () => {
  const MAX = 8
  it('pivota las cuotas y reporta cero truncadas cuando caben', () => {
    const cuotas = [
      { fc: '01/01', monto: '50', medio_pago: 'EF', entidad_empresa: 'WE', entidad_financiera: 'BCP', n_operacion: 'OP1', fc_proyeccion: '01/01', monto_proyeccion: '50' }
    ]
    const { row, truncated } = buildCuotasRow({ cod: 'C1', cuotas_json: cuotas }, MAX)
    expect(truncated).toBe(0)
    expect(row).toHaveLength(10 + MAX * 6 + MAX * 2)
    expect(row[0]).toBe('C1')
    expect(row[10]).toBe('01/01')
    expect(row[11]).toBe('50')
  })
  it('rellena con vacios las cuotas faltantes', () => {
    const { row } = buildCuotasRow({ cuotas_json: [] }, MAX)
    expect(row).toHaveLength(10 + MAX * 6 + MAX * 2)
    expect(row.slice(10).every(c => c === '')).toBe(true)
  })
  it('reporta la cantidad de cuotas truncadas por encima de MAX', () => {
    const cuotas = Array.from({ length: MAX + 3 }, () => ({ fc: 'x', monto: '1' }))
    const { truncated } = buildCuotasRow({ cuotas_json: cuotas }, MAX)
    expect(truncated).toBe(3)
  })
  it('trata cuotas_json no-array como sin cuotas', () => {
    const { row, truncated } = buildCuotasRow({ cuotas_json: null }, MAX)
    expect(truncated).toBe(0)
    expect(row).toHaveLength(10 + MAX * 6 + MAX * 2)
  })
})

describe('buildSlackEnrollmentBlocks', () => {
  const d = {
    enrollment_id: 42,
    program_name: 'Excel',
    fecha_inicio: '01/01/2026',
    celular: '999',
    asesor: 'WEB - x',
    notes: 'obs',
    fecha_registro: '01/01/2026 10:00'
  }
  it('arma header, divider, seccion principal y contexto final', () => {
    const blocks = buildSlackEnrollmentBlocks(d, [])
    expect(blocks[0].type).toBe('header')
    expect(blocks[1].type).toBe('divider')
    expect(blocks[2].type).toBe('section')
    const last = blocks[blocks.length - 1]
    expect(last.type).toBe('context')
    expect(last.elements[0].text).toContain('Matrícula #42')
  })
  it('sin adjuntos agrega el bloque de advertencia', () => {
    const blocks = buildSlackEnrollmentBlocks(d, [])
    const warn = blocks.find(b => b.type === 'context' && b.elements?.[0]?.text?.includes('Sin constancias'))
    expect(warn).toBeTruthy()
  })
  it('con adjuntos lista los links', () => {
    const blocks = buildSlackEnrollmentBlocks(d, [{ url: 'http://x/a.pdf', name: 'A' }])
    const section = blocks.find(b => b.type === 'section' && b.text?.text?.includes('Constancias adjuntas (1)'))
    expect(section).toBeTruthy()
    expect(section.text.text).toContain('<http://x/a.pdf|A>')
  })
})
