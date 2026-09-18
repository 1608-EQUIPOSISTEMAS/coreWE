import { describe, it, expect } from 'vitest'
import { evaluarReloj, calcularSla, sumarMinutos, UMBRAL_POR_VENCER } from '../sla/sla-clock.js'

// Portado de sla.calculo.test.ts del sistema origen. El instante de referencia
// entra por parametro, asi que las fronteras se prueban sin reloj real.

const INICIO = new Date('2026-01-01T00:00:00Z')
const enMinutos = m => new Date(INICIO.getTime() + m * 60_000)

describe('evaluarReloj', () => {
  it('sin plazo no hay veredicto', () => {
    const r = evaluarReloj(null, null, INICIO, enMinutos(500))
    expect(r.estado).toBeNull()
    expect(r.msRestantes).toBeNull()
  })

  it('con margen esta EN_PLAZO', () => {
    // 10 de 60 minutos consumidos: 17%.
    expect(evaluarReloj(enMinutos(60), null, INICIO, enMinutos(10)).estado).toBe('EN_PLAZO')
  })

  it('pasa a POR_VENCER al consumir el umbral del plazo TOTAL', () => {
    // El umbral es 0.8: a los 48 de 60 minutos.
    expect(evaluarReloj(enMinutos(60), null, INICIO, enMinutos(47)).estado).toBe('EN_PLAZO')
    expect(evaluarReloj(enMinutos(60), null, INICIO, enMinutos(48)).estado).toBe('POR_VENCER')
    expect(UMBRAL_POR_VENCER).toBe(0.8)
  })

  it('el umbral es relativo, no absoluto', () => {
    // A falta de 12 minutos: en un plazo de 60 es POR_VENCER, en uno de 4320 no.
    expect(evaluarReloj(enMinutos(60), null, INICIO, enMinutos(48)).estado).toBe('POR_VENCER')
    expect(evaluarReloj(enMinutos(4320), null, INICIO, enMinutos(4308)).estado).toBe('POR_VENCER')
    expect(evaluarReloj(enMinutos(4320), null, INICIO, enMinutos(1000)).estado).toBe('EN_PLAZO')
  })

  it('pasado el plazo esta VENCIDO y msRestantes es negativo', () => {
    const r = evaluarReloj(enMinutos(60), null, INICIO, enMinutos(75))
    expect(r.estado).toBe('VENCIDO')
    expect(r.msRestantes).toBe(-15 * 60_000)
  })

  it('completado dentro del plazo es CUMPLIDO; fuera, INCUMPLIDO', () => {
    expect(evaluarReloj(enMinutos(60), enMinutos(59), INICIO, enMinutos(999)).estado).toBe('CUMPLIDO')
    expect(evaluarReloj(enMinutos(60), enMinutos(61), INICIO, enMinutos(999)).estado).toBe('INCUMPLIDO')
  })

  it('justo en el limite todavia cuenta como CUMPLIDO', () => {
    expect(evaluarReloj(enMinutos(60), enMinutos(60), INICIO, enMinutos(999)).estado).toBe('CUMPLIDO')
  })

  it('el veredicto queda congelado: el tiempo no vuelve VENCIDO un CUMPLIDO', () => {
    const cumplido = evaluarReloj(enMinutos(60), enMinutos(30), INICIO, enMinutos(30))
    const mucho = evaluarReloj(enMinutos(60), enMinutos(30), INICIO, enMinutos(100_000))
    expect(cumplido.estado).toBe('CUMPLIDO')
    expect(mucho.estado).toBe('CUMPLIDO')
  })

  it('acepta fechas en string, como salen de pg', () => {
    expect(evaluarReloj(enMinutos(60).toISOString(), null, INICIO.toISOString(), enMinutos(10)).estado).toBe('EN_PLAZO')
  })
})

describe('calcularSla', () => {
  it('ambos relojes arrancan al crear el ticket, no al tomarlo', () => {
    const sla = calcularSla({
      registration_date: INICIO,
      first_response_due_at: enMinutos(60),
      first_response_at: enMinutos(30),
      resolution_due_at: enMinutos(480),
      resolved_at: null
    }, enMinutos(500))

    expect(sla.respuesta.estado).toBe('CUMPLIDO')
    // Lo tomaron a tiempo pero nunca lo cerraron: el reloj de resolucion vencio.
    expect(sla.resolucion.estado).toBe('VENCIDO')
  })
})

describe('sumarMinutos', () => {
  it('suma minutos corridos: el reloj no para fuera de horario', () => {
    // Viernes 18:00 + 480 min = sabado 02:00, no el lunes.
    const viernes = new Date('2026-01-02T18:00:00Z')
    expect(sumarMinutos(viernes, 480).toISOString()).toBe('2026-01-03T02:00:00.000Z')
  })
})
