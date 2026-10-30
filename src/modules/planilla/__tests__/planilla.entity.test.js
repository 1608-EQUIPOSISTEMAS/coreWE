import { describe, it, expect } from 'vitest'
import {
  minutosDeTardanza, calcularTrabajador, horarioDeArea, parsearMarcaciones,
  agruparPorDia, parsearPersonal, validarPeriodo, puedeVerSueldos
} from '../planilla.entity.js'
import { DomainError } from '../../../shared/errors.js'

describe('minutosDeTardanza (ingreso 09:00)', () => {
  it.each([
    ['08:45:00', 0], ['09:00:00', 0], ['09:10:59', 0],
    ['09:11:00', 30], ['09:30:59', 30],
    ['09:31:00', 60], ['10:45:00', 60]
  ])('%s -> %i min', (entrada, min) => {
    expect(minutosDeTardanza(entrada, '09:00')).toBe(min)
  })
  it('respeta el horario 08:30 de FICO/B2B', () => {
    expect(minutosDeTardanza('08:40:59', '08:30')).toBe(0)
    expect(minutosDeTardanza('08:41:00', '08:30')).toBe(30)
    expect(minutosDeTardanza('09:05:00', '08:30')).toBe(60)
  })
})

describe('horarioDeArea', () => {
  it('FICO y B2B entran 08:30, el resto 09:00', () => {
    expect(horarioDeArea('fico').ingreso).toBe('08:30')
    expect(horarioDeArea('B2B').ingreso).toBe('08:30')
    expect(horarioDeArea('COMERCIAL').ingreso).toBe('09:00')
    expect(horarioDeArea(null).salida).toBe('19:30')
  })
})

describe('calcularTrabajador', () => {
  it('40 % en quincena y 60 % menos tardanzas a fin de mes', () => {
    // 3000 / 30 / 8 / 60 = 0.208333 por minuto
    const r = calcularTrabajador({ sueldoNeto: 3000, horaIngreso: '09:00' }, [
      { fecha: '2026-10-01', entrada: '09:05:00' },
      { fecha: '2026-10-02', entrada: '09:15:00' },
      { fecha: '2026-10-05', entrada: '09:45:00' },
      { fecha: '2026-10-06', entrada: '09:50:00', justificado: true }
    ])
    expect(r.pago_quincena).toBe(1200)
    expect(r.pago_fin_mes_bruto).toBe(1800)
    expect(r.minutos_tardanza).toBe(90)
    expect(r.tardanzas).toBe(2)
    expect(r.descuento_tardanza).toBe(18.75)
    expect(r.pago_fin_mes).toBe(1781.25)
  })
  it('el descuento nunca supera el pago de fin de mes', () => {
    const dias = Array.from({ length: 400 }, (_, i) => ({ fecha: String(i), entrada: '11:00:00' }))
    const r = calcularTrabajador({ sueldoNeto: 100, horaIngreso: '09:00' }, dias)
    expect(r.pago_fin_mes).toBe(0)
  })
})

describe('parsearMarcaciones + agruparPorDia', () => {
  it('lee una exportacion tipo ZKTeco (columna Fecha/Hora en texto)', () => {
    const filas = [
      ['Reporte de asistencia'],
      ['No.', 'Nombre', 'Fecha/Hora', 'Estado'],
      ['101', 'Ana Perez', '01/10/2026 08:58:10', 'Entrada'],
      ['101', 'Ana Perez', '01/10/2026 19:35:00', 'Salida'],
      ['102', 'Luis Rojas', '01/10/2026 09:12:00', 'Entrada'],
      ['', '', '', '']
    ]
    const { marcaciones, errores } = parsearMarcaciones(filas)
    expect(errores).toHaveLength(0)
    const dias = agruparPorDia(marcaciones)
    expect(dias).toEqual([
      { codigo: '101', nombre: 'Ana Perez', departamento: '', fecha: '2026-10-01', entrada: '08:58:10', salida: '19:35:00', marcas: 2 },
      { codigo: '102', nombre: 'Luis Rojas', departamento: '', fecha: '2026-10-01', entrada: '09:12:00', salida: null, marcas: 1 }
    ])
  })
  it('lee columnas separadas de fecha y hora con celdas Date de Excel y AM/PM', () => {
    const filas = [
      ['ID', 'Nombre', 'Fecha', 'Hora'],
      [7, 'X', new Date(Date.UTC(2026, 9, 3)), '9:31 a. m.'],
      [7, 'X', new Date(Date.UTC(2026, 9, 3)), '7:40 p. m.']
    ]
    const dias = agruparPorDia(parsearMarcaciones(filas).marcaciones)
    expect(dias[0]).toMatchObject({ codigo: '7', fecha: '2026-10-03', entrada: '09:31:00', salida: '19:40:00' })
  })
  it('falla con un mensaje claro si no reconoce las columnas', () => {
    expect(() => parsearMarcaciones([['a', 'b'], ['1', '2']])).toThrow(DomainError)
  })
})

describe('parsearPersonal', () => {
  it('lee la plantilla y normaliza montos', () => {
    const { personal, errores } = parsearPersonal([
      ['Codigo huellero', 'DNI', 'Nombre', 'Area', 'Sueldo neto'],
      ['101', '12345678', 'Ana Perez', 'fico', 'S/ 2,500.50'],
      ['102', '', 'Sin sueldo', 'TI', '']
    ])
    expect(personal).toEqual([{ codigo: '101', dni: '12345678', nombre: 'Ana Perez', area: 'FICO', sueldo_neto: 2500.5 }])
    expect(errores).toEqual([{ fila: 3, motivo: 'Sueldo neto invalido' }])
  })
  it('rechaza codigos repetidos', () => {
    expect(() => parsearPersonal([
      ['Codigo', 'Nombre', 'Sueldo'], ['1', 'A', 100], ['1', 'B', 200]
    ])).toThrow(/repetido/)
  })
})

describe('validarPeriodo y permisos', () => {
  it('calcula el rango del mes', () => {
    expect(validarPeriodo(2026, 2)).toEqual({ anio: 2026, mes: 2, desde: '2026-02-01', hasta: '2026-02-28' })
    expect(() => validarPeriodo(2026, 13)).toThrow(DomainError)
  })
  it('solo TALENTO ve sueldos (ni ADMIN)', () => {
    expect(puedeVerSueldos(['TALENTO'])).toBe(true)
    expect(puedeVerSueldos(['ADMIN'])).toBe(false)
  })
})
