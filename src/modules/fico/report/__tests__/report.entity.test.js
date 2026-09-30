import { describe, it, expect } from 'vitest'
import {
  studentCompliance, collectionGoal, buildFicoReport,
  debtAging, historicalCollectionRate, collectionForecast, collectionByMethod, enrollmentOutcomes
} from '../report.entity.js'

const cuota = (customer_id, vence, pagada_el, extra = {}) =>
  ({ customer_id, vence, soles: 100, pagada: pagada_el !== null, pagada_el, ...extra })

describe('studentCompliance', () => {
  it('se juzga por alumno: una cuota impaga basta para no cumplir', () => {
    const r = studentCompliance([
      cuota(1, '2026-08-05', '2026-08-04'), // a tiempo
      cuota(2, '2026-08-05', '2026-08-10'), // tarde
      cuota(3, '2026-08-05', '2026-08-01'),
      cuota(3, '2026-08-20', null) // debe la segunda
    ], '2026-09-01')
    expect(r).toMatchObject({ alumnos: 3, cumplen: 2, puntuales: 1, tarde: 1, no_pagan: 1, pct_cumplen: 66.7 })
    expect(r.impagas).toEqual({ cuotas: 1, soles: 100 })
  })

  it('la cuota que vence hoy o despues todavia no se juzga', () => {
    const r = studentCompliance([cuota(1, '2026-09-29', null), cuota(2, '2026-10-05', null)], '2026-09-29')
    expect(r).toMatchObject({ alumnos: 0, pct_cumplen: null, tono_cumplen: null })
  })

  it('pagada sin fecha de pago cumple pero no cuenta como puntual', () => {
    const r = studentCompliance([cuota(1, '2026-08-05', null, { pagada: true })], '2026-09-01')
    expect(r).toMatchObject({ cumplen: 1, puntuales: 0 })
  })
})

describe('collectionGoal', () => {
  it('prorratea la meta mensual por los dias del rango', () => {
    expect(collectionGoal({ start: '2026-09-01', end: '2026-09-30' })).toBe(60000)
    expect(collectionGoal({ start: '2026-09-16', end: '2026-10-15' })).toBe(Math.round(60000 * 15 / 30 + 60000 * 15 / 31))
  })
})

describe('buildFicoReport', () => {
  it('suma lo cobrado del rango y arma 6 meses de serie', () => {
    const r = buildFicoReport({
      period: { start: '2026-08-01', end: '2026-08-31' },
      today: '2026-09-29',
      cuotas: [cuota(1, '2026-08-05', '2026-08-04')],
      cobros: [{ dia: '2026-08-04', soles: 45000.4 }, { dia: '2026-07-30', soles: 999 }]
    })
    expect(r.cobranza).toMatchObject({ logrado: 45000, meta: 60000, pct: 75 })
    expect(r.alumnos.pct_puntual).toBe(100)
    expect(r.meses.map((m) => m.mes)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'])
    expect(r.meses.at(-2).cobrado).toBe(999)
  })
})

describe('debtAging', () => {
  const pendiente = (customer_id, vence, soles = 100) => ({ enrollment_id: customer_id, customer_id, alumno: `A${customer_id}`, vence, soles })

  it('reparte lo vencido por dias de atraso y deja fuera lo que no vence', () => {
    const r = debtAging([
      pendiente(1, '2026-09-19'), // 10 dias
      pendiente(1, '2026-08-01', 50), // 59 dias
      pendiente(2, '2026-05-01'), // 151 dias
      pendiente(3, '2026-09-29'), // vence hoy: no esta vencida
      pendiente(4, '2026-10-10')
    ], '2026-09-29')
    expect(r.tramos.map((t) => t.soles)).toEqual([100, 50, 100])
    expect(r).toMatchObject({ total: 250, alumnos: 2 })
    expect(r.top[0]).toMatchObject({ alumno: 'A1', cuotas: 2, soles: 150, dias: 59 })
  })
})

describe('proyeccion de cobranza', () => {
  it('la tasa historica pesa en soles y no mira el mes en curso', () => {
    const cuotas = [
      { vence: '2026-08-05', soles: 300, pagada: true },
      { vence: '2026-08-06', soles: 100, pagada: false },
      { vence: '2026-09-05', soles: 999, pagada: false } // mes en curso
    ]
    expect(historicalCollectionRate(cuotas, '2026-09-29')).toBe(0.75)
    expect(historicalCollectionRate([], '2026-09-29')).toBeNull()
  })

  it('mes en curso = cobrado + por vencer x tasa; los siguientes solo lo programado', () => {
    const [sep, oct, nov] = collectionForecast({
      pendientes: [{ vence: '2026-09-30', soles: 1000 }, { vence: '2026-09-10', soles: 500 }, { vence: '2026-10-15', soles: 2000 }],
      cobros: [{ dia: '2026-09-02', soles: 40000 }],
      tasa: 0.9,
      today: '2026-09-29'
    })
    expect(sep).toMatchObject({ mes: '2026-09', cobrado: 40000, programado: 1000, esperado: 40900, falta: 19100 })
    expect(oct).toMatchObject({ mes: '2026-10', programado: 2000, esperado: 1800 })
    expect(nov.mes).toBe('2026-11')
  })
})

describe('collectionByMethod', () => {
  it('une el catalogo viejo con el nuevo y ordena por monto', () => {
    const r = collectionByMethod([
      { alias: 'we_payment_medium_transfer', medio: 'Transferencia', pagos: 2, soles: 300 },
      { alias: 'we_payment_method_transfer', medio: 'Transferencia bancaria', pagos: 1, soles: 100 },
      { alias: 'we_payment_medium_yape', medio: 'YAPE', pagos: 5, soles: 500 },
      { alias: null, medio: null, pagos: 1, soles: 100 }
    ])
    expect(r.total).toBe(1000)
    expect(r.medios.map((m) => [m.medio, m.soles, m.pct])).toEqual([
      ['YAPE', 500, 50], ['Transferencia', 400, 40], ['Sin medio registrado', 100, 10]
    ])
  })
})

describe('enrollmentOutcomes', () => {
  it('suma los dias y saca el % de PP sin contar becas', () => {
    const r = enrollmentOutcomes([
      { dia: '2026-08-01', total: 10, pt: 6, pp: 2, becas: 2, retirados: 1, rp: 1, cc: 0 },
      { dia: '2026-08-02', total: 10, pt: 4, pp: 4, becas: 2, retirados: 1, rp: 0, cc: 1 }
    ])
    expect(r).toMatchObject({ total: 20, pt: 10, pp: 6, becas: 4, retirados: 2, rp: 1, cc: 1 })
    expect(r.pct_pp).toBe(37.5) // 6 de 16 pagadas
    expect(r.pct_retirados).toBe(10)
  })

  it('sin inscripciones no inventa porcentajes', () => {
    expect(enrollmentOutcomes([])).toMatchObject({ total: 0, pct_retirados: null, pct_pp: null })
  })
})
