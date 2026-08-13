import { describe, it, expect } from 'vitest'
import {
  isZeroAmountEmail,
  buildSalesRow,
  buildAulaRow,
  buildConsolidadoRow,
  buildCuotasRow,
  buildAdicionalesRow
} from '../integration.entity.js'

// Alumno de la lista de monto-cero y uno normal, con los mismos montos.
const LISTED = 'wchambi@bancoripley.com.pe'
const NORMAL = 'alguien.normal@gmail.com'
const amounts = { dsct: 100, al_dia: 200, inicial: 300, saldo: 400, ingreso: 500, descuento: 50, monto: 600 }
const row = (correo) => ({ correo, nombres: 'X', ...amounts })

describe('isZeroAmountEmail', () => {
  it('matchea normalizando mayusculas y espacios', () => {
    expect(isZeroAmountEmail('  WCHAMBI@BANCORIPLEY.COM.PE ')).toBe(true)
    expect(isZeroAmountEmail(LISTED)).toBe(true)
    // los 4 de Excel Intermedio ya pagaron: fuera de la lista desde 13/08/2026
    expect(isZeroAmountEmail('joselujan.barton@gmail.com')).toBe(false)
    expect(isZeroAmountEmail(NORMAL)).toBe(false)
    expect(isZeroAmountEmail(null)).toBe(false)
    expect(isZeroAmountEmail('')).toBe(false)
  })
})

describe('montos forzados a 0 en las hojas del sync', () => {
  it('Ventas: dsct/al_dia/inicial/saldo/ingreso van en 0 para el listado', () => {
    const s = buildSalesRow(row(LISTED))
    expect([s[11], s[12], s[13], s[14], s[15]]).toEqual([0, 0, 0, 0, 0])
    const n = buildSalesRow(row(NORMAL))
    expect([n[11], n[12], n[13], n[14], n[15]]).toEqual([100, 200, 300, 400, 500])
  })

  it('Aula: al_dia/saldo/descuento van en 0 para el listado', () => {
    const a = buildAulaRow(row(LISTED))
    expect([a[10], a[11], a[13]]).toEqual([0, 0, 0])
    const n = buildAulaRow(row(NORMAL))
    expect([n[10], n[11], n[13]]).toEqual([200, 400, 50])
  })

  it('Consolidado: dsct/inicial/cuotas/saldo/ingreso van en 0 para el listado', () => {
    const c = buildConsolidadoRow({ correo: LISTED, dsct: 1, inicial: 2, c1: 3, c5: 4, saldo: 5, ingreso: 6 })
    expect([c[11], c[13], c[15], c[23], c[24], c[25]]).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('Cuotas: monto y monto_proyeccion de cada cuota van en 0 para el listado', () => {
    const cuotas_json = [{ fc: '2026-01-01', monto: 700, monto_proyeccion: 800 }]
    const { row: rz } = buildCuotasRow({ correo: LISTED, cuotas_json }, 3)
    expect(rz[11]).toBe(0)              // C1 (base=10 + fc en 10)
    const { row: rn } = buildCuotasRow({ correo: NORMAL, cuotas_json }, 3)
    expect(rn[11]).toBe(700)
  })

  it('Adicionales: monto va en 0 para el listado', () => {
    expect(buildAdicionalesRow(row(LISTED), 0)[10]).toBe(0)
    expect(buildAdicionalesRow(row(NORMAL), 0)[10]).toBe(600)
  })
})
