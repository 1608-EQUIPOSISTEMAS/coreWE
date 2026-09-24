import { describe, it, expect } from 'vitest'
import { evaluarReloj, calcularSla, sumarMinutos, sumarMinutosHabiles, UMBRAL_POR_VENCER } from '../sla/sla-clock.js'

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

// Horario habil: lun-vie 09:00-18:00 Lima (UTC-5). 2026-01-01 es jueves.
describe('sumarMinutosHabiles', () => {
  const iso = d => d.toISOString()

  it('dentro del horario suma directo', () => {
    // Jueves 10:00 Lima + 60 = 11:00 Lima.
    expect(iso(sumarMinutosHabiles(new Date('2026-01-01T15:00:00Z'), 60))).toBe('2026-01-01T16:00:00.000Z')
  })

  it('lo que no alcanza el viernes sigue el lunes', () => {
    // Viernes 17:50 Lima + 30 = 10 min el viernes + 20 el lunes -> lunes 09:20.
    expect(iso(sumarMinutosHabiles(new Date('2026-01-02T22:50:00Z'), 30))).toBe('2026-01-05T14:20:00.000Z')
  })

  it('un ticket del fin de semana empieza a contar el lunes a las 09:00', () => {
    // Sabado 10:00 Lima + 15 = lunes 09:15.
    expect(iso(sumarMinutosHabiles(new Date('2026-01-03T15:00:00Z'), 15))).toBe('2026-01-05T14:15:00.000Z')
  })

  it('antes de abrir espera la apertura; despues de cerrar, la del dia siguiente', () => {
    // Jueves 07:00 Lima + 60 = 10:00.
    expect(iso(sumarMinutosHabiles(new Date('2026-01-01T12:00:00Z'), 60))).toBe('2026-01-01T15:00:00.000Z')
    // Jueves 20:00 Lima + 15 = viernes 09:15.
    expect(iso(sumarMinutosHabiles(new Date('2026-01-02T01:00:00Z'), 15))).toBe('2026-01-02T14:15:00.000Z')
  })

  it('un dia habil (540 min) cae a la misma hora del dia habil siguiente', () => {
    // Jueves 10:00 Lima + 1 dia habil = viernes 10:00.
    expect(iso(sumarMinutosHabiles(new Date('2026-01-01T15:00:00Z'), 540))).toBe('2026-01-02T15:00:00.000Z')
  })
})
