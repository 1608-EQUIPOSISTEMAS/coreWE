// El Sheet B2B mezcla convenciones de miles/decimales en la misma columna.
// Equivocarse cambia un monto por mil, asi que el parser tiene test propio.
import { describe, it, expect } from 'vitest'
import { numero } from '../scripts/sheet-b2b.parse.mjs'

describe('numero (montos del Sheet B2B)', () => {
  it('lee el punto como separador de miles (es-PE)', () => {
    expect(numero('2.130')).toBe(2130)
    expect(numero('1.123')).toBe(1123)
    expect(numero('2.520')).toBe(2520)
  })

  it('lee la coma como separador decimal (es-PE)', () => {
    expect(numero('4.561,50')).toBe(4561.5)
    expect(numero('236,95')).toBe(236.95)
    expect(numero('721,5')).toBe(721.5)
  })

  it('lee el formato en-US cuando la coma va antes del punto', () => {
    expect(numero('1,162.5')).toBe(1162.5)
    expect(numero('12,345.67')).toBe(12345.67)
  })

  it('redondea a 2 decimales los resultados de formula', () => {
    expect(numero('924,105')).toBe(924.11)
    expect(numero('18482,1')).toBe(18482.1)
  })

  it('limpia simbolos de moneda', () => {
    expect(numero('S/.3.500')).toBe(3500)
    expect(numero('$500')).toBe(500)
    expect(numero('S/.150')).toBe(150)
  })

  it('trata la basura del export como vacio', () => {
    expect(numero('\\-')).toBeNull()
    expect(numero('\\#REF\\!')).toBeNull()
    expect(numero('')).toBeNull()
    expect(numero(null)).toBeNull()
  })

  it('deja pasar los enteros sin separador', () => {
    expect(numero('12636')).toBe(12636)
    expect(numero('976')).toBe(976)
  })
})
