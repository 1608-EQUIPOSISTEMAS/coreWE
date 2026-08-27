import { describe, it, expect } from 'vitest'
import { CONVENIOS_HEADER_ROW, buildConveniosRow } from '../integration.entity.js'

// Fila tal como la devuelve getFicoConvenios para la venta de convenio que el
// negocio uso de referencia (enrollment 16394, CLINICA INTERNACIONAL).
const fila = {
  fecha: '12/08/2026',
  empresa: 'CLINICA INTERNACIONAL S A',
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
      '12/08/2026', 'CLINICA INTERNACIONAL S A', 'B2B NACIONAL', 'CONVENIO',
      'JANETH NATALY CASTILLO GUTIERREZ', '937378654', 'GEST. COMP. Y PROV.',
      '26/08/2026', 'P', '14/08/2026', 'PEN', '328,00', 'PP', 'AGO', '2026',
      'janicastillog@gmail.com', '80,00', 'CURSO', 'En vivo', 'B2B - AE30'
    ])
  })

  // EMPRESA sale del convenio del lead, que se empezo a guardar el 2026-08-24:
  // las ventas anteriores no la tienen y la fila tiene que subir igual.
  it('deja EMPRESA vacia si el lead no tiene empresa vinculada', () => {
    const celdas = buildConveniosRow({ ...fila, empresa: '' })
    expect(celdas[1]).toBe('')
    expect(celdas[11]).toBe('328,00')
  })

  // El negocio pidio (2026-08-25) que estas dos columnas sean fijas: toda
  // venta de la hoja es B2B NACIONAL y su linea comercial es CONVENIO.
  it('fija TIPO DE CLIENTE y PROGRAMA aunque la query traiga otra cosa', () => {
    const celdas = buildConveniosRow({ ...fila, tipo_cliente: 'P', programa: 'GESTION DE COMPRAS' })
    expect(celdas[2]).toBe('B2B NACIONAL')
    expect(celdas[3]).toBe('CONVENIO')
  })

  // La lista desplegable de UNIDAD solo acepta Online / En vivo / Evento /
  // Membresia; el catalogo de la BD guarda 'En Vivo'.
  it('escribe UNIDAD como la espera la lista de la hoja', () => {
    expect(buildConveniosRow(fila)[18]).toBe('En vivo')
    expect(buildConveniosRow({ ...fila, unidad: 'Online' })[18]).toBe('Online')
  })

  it('fuerza monto y pago efectuado a 0 para los correos de monto-cero', () => {
    const celdas = buildConveniosRow({ ...fila, correo: 'wchambi@bancoripley.com.pe' })
    expect(celdas[11]).toBe(0)
    expect(celdas[16]).toBe(0)
  })
})
