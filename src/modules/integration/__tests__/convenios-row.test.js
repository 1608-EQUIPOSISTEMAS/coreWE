import { describe, it, expect } from 'vitest'
import { CONVENIOS_HEADER_ROW, buildConveniosRow } from '../integration.entity.js'

// Fila tal como la devuelve getFicoConvenios para la venta de convenio que el
// negocio uso de referencia (enrollment 16394, CLINICA INTERNACIONAL).
const fila = {
  fecha: '12/08/2026',
  empresa: 'CLINICA INTERNACIONAL S A',
  tipo_cliente: 'P',
  programa: 'GESTIÓN DE COMPRAS Y PROVEEDORES',
  nombres: 'JANETH NATALY CASTILLO GUTIERREZ',
  numero: '937378654',
  nombre_p: 'GEST. COMP. Y PROV.',
  f_programa: '26/08/2026',
  ocup: 'P',
  f_pago: '14/08/2026',
  moneda: 'PEN',
  monto: '328,00',
  tipo_pago: 'PP',
  mes: 'AGO',
  anio: '2026',
  correo: 'janicastillog@gmail.com',
  pago_efectuado: '80,00',
  tipo_program: 'CURSO',
  unidad: 'En Vivo',
  asesor: 'B2B - AE30'
}

describe('buildConveniosRow', () => {
  it('respeta el orden de las 20 columnas de la hoja', () => {
    const celdas = buildConveniosRow(fila)
    expect(celdas).toHaveLength(CONVENIOS_HEADER_ROW.length)
    expect(celdas).toEqual([
      '12/08/2026', 'CLINICA INTERNACIONAL S A', 'P', 'GESTIÓN DE COMPRAS Y PROVEEDORES',
      'JANETH NATALY CASTILLO GUTIERREZ', '937378654', 'GEST. COMP. Y PROV.',
      '26/08/2026', 'P', '14/08/2026', 'PEN', '328,00', 'PP', 'AGO', '2026',
      'janicastillog@gmail.com', '80,00', 'CURSO', 'En Vivo', 'B2B - AE30'
    ])
  })

  // EMPRESA sale del convenio del lead, que se empezo a guardar el 2026-08-24:
  // las ventas anteriores no la tienen y la fila tiene que subir igual.
  it('deja EMPRESA vacia si el lead no tiene empresa vinculada', () => {
    const celdas = buildConveniosRow({ ...fila, empresa: '' })
    expect(celdas[1]).toBe('')
    expect(celdas[11]).toBe('328,00')
  })

  it('fuerza monto y pago efectuado a 0 para los correos de monto-cero', () => {
    const celdas = buildConveniosRow({ ...fila, correo: 'wchambi@bancoripley.com.pe' })
    expect(celdas[11]).toBe(0)
    expect(celdas[16]).toBe(0)
  })
})
