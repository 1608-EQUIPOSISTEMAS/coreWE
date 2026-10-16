import { describe, it, expect } from 'vitest'
import { summarizeHistory, buildSuggestions, buildOffers, MIN_SAMPLE, MIN_PROBABILITY } from '../prediccion.entity.js'

const consulta = (program_id, event_date) => ({ event_type: 'CONSULTA', program_id, event_date })
const compra = (program_id, event_date, amount = null) => ({ event_type: 'COMPRA', program_id, event_date, amount })
const programa = (program_id, tier, suggestable = true) => ({ program_id, program_name: `P${program_id}`, tier, suggestable })

describe('summarizeHistory', () => {
  it('cuenta consultas y compras, suma solo montos del ERP y mide la recencia', () => {
    const r = summarizeHistory([
      compra(1, '2026-05-22', '66.00'), consulta(1, '2026-05-04'), compra(2, '2024-01-10', null)
    ], '2026-06-01')
    expect(r).toMatchObject({
      consultas: 1, compras: 2, monto_erp: 66, primera_fecha: '2024-01-10',
      ultima_fecha: '2026-05-22', dias_desde_ultima: 10, es_cliente: true
    })
  })

  it('sin historia no es cliente y no inventa fechas', () => {
    expect(summarizeHistory([], '2026-06-01')).toMatchObject({ compras: 0, ultima_fecha: null, dias_desde_ultima: null, es_cliente: false })
  })
})

describe('buildSuggestions', () => {
  const base = { history: [], inquiries: [], coPurchases: [], programs: [] }

  it('ofrece lo que consulto con la tasa real del grupo y la fecha en dd/mm/aaaa', () => {
    const [s] = buildSuggestions({
      ...base,
      history: [consulta(39, '2026-05-04')],
      inquiries: [{ program_id: 39, consultaron: 1245, compraron: 120 }],
      programs: [programa(39, 'TOP')]
    })
    expect(s).toMatchObject({ program_id: 39, probability: 9.6, sample: 1245, tier: 'TOP' })
    expect(s.reason).toContain('04/05/2026')
  })

  it(`con menos de ${MIN_SAMPLE} casos no muestra porcentaje: 2 de 5 no es 40%`, () => {
    const out = buildSuggestions({
      ...base,
      history: [compra(15, '2025-01-01')],
      coPurchases: [{ from_program: 15, to_program: 39, buyers: MIN_SAMPLE - 1, next_buyers: 12 }],
      programs: [programa(15, 'BAJO'), programa(39, 'TOP')]
    })
    expect(out).toEqual([])
  })

  it(`bajo la conversion base (${MIN_PROBABILITY}%) no sugiere: no es mejor que llamar a cualquiera`, () => {
    const out = buildSuggestions({
      ...base,
      history: [compra(15, '2025-01-01')],
      coPurchases: [{ from_program: 15, to_program: 40, buyers: 535, next_buyers: 6 }],
      programs: [programa(15, 'BAJO'), programa(40, 'TOP')]
    })
    expect(out).toEqual([])
  })

  it('nunca ofrece lo que ya compro', () => {
    const out = buildSuggestions({
      ...base,
      history: [compra(15, '2025-01-01'), compra(39, '2025-03-01'), consulta(39, '2025-02-01')],
      inquiries: [{ program_id: 39, consultaron: 500, compraron: 100 }],
      coPurchases: [{ from_program: 15, to_program: 39, buyers: 100, next_buyers: 40 }],
      programs: [programa(15, 'BAJO'), programa(39, 'TOP')]
    })
    expect(out).toEqual([])
  })

  it('no ofrece online ni membresias (el asesor no cobra comision por ellos)', () => {
    const out = buildSuggestions({
      ...base,
      history: [compra(15, '2025-01-01')],
      coPurchases: [{ from_program: 15, to_program: 120, buyers: 100, next_buyers: 50 }],
      programs: [programa(15, 'BAJO'), programa(120, 'TOP', false)]
    })
    expect(out).toEqual([])
  })

  it('ordena por valor: un TOP al 20% va antes que un BAJO al 35%', () => {
    const out = buildSuggestions({
      ...base,
      history: [compra(15, '2025-01-01')],
      coPurchases: [
        { from_program: 15, to_program: 50, buyers: 100, next_buyers: 35 },
        { from_program: 15, to_program: 39, buyers: 100, next_buyers: 20 }
      ],
      programs: [programa(15, 'BAJO'), programa(50, 'BAJO'), programa(39, 'TOP')]
    })
    expect(out.map((s) => s.program_id)).toEqual([39, 50])
    // La probabilidad que ve el asesor es la real, no la multiplicada por el factor.
    expect(out.map((s) => s.probability)).toEqual([20, 35])
  })

  it('si un programa sale por las dos vias se queda la razon mas probable', () => {
    const out = buildSuggestions({
      ...base,
      history: [compra(15, '2025-01-01'), consulta(39, '2026-05-04')],
      inquiries: [{ program_id: 39, consultaron: 1000, compraron: 80 }],
      coPurchases: [{ from_program: 15, to_program: 39, buyers: 100, next_buyers: 25 }],
      programs: [programa(15, 'BAJO'), programa(39, 'TOP')]
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ program_id: 39, probability: 25 })
    expect(out[0].reason).toContain('compraron P15')
  })

  it('programa sin clasificacion se trata como BAJO', () => {
    const out = buildSuggestions({
      ...base,
      history: [compra(15, '2025-01-01')],
      coPurchases: [{ from_program: 15, to_program: 77, buyers: 100, next_buyers: 30 }],
      programs: [programa(15, 'BAJO'), { program_id: 77, program_name: 'P77', tier: null, suggestable: true }]
    })
    expect(out[0].tier).toBe('BAJO')
  })
})

describe('buildOffers', () => {
  const detalle = { program_id: 88, next_start: '2026-11-05', next_code: 'E3-26', price_professional: '840.00', price_student: '750.00', reservation: '100.00' }

  it('lo que pidio va primero aunque su probabilidad este bajo el piso, con fecha y precio', () => {
    const [o] = buildOffers({
      history: [consulta(88, '2026-08-17'), consulta(88, '2026-01-27'), compra(27, '2025-12-29')],
      inquiries: [{ program_id: 88, consultaron: 200, compraron: 6 }],
      coPurchases: [],
      programs: [programa(88, 'NORMAL'), programa(27, 'TOP')],
      details: [detalle]
    })
    expect(o).toMatchObject({ kind: 'PIDIO', program_id: 88, probability: 3, sample: 200 })
    expect(o.reason).toContain('Lo consultó 2 veces (última: 17/08/2026)')
    expect(o.edicion).toEqual({ inicio: '2026-11-05', codigo: 'E3-26' })
    expect(o.precio).toEqual({ profesional: 840, estudiante: 750, reserva: 100 })
  })

  it('sin muestra suficiente lo ofrece igual pero sin inventar el %', () => {
    const [o] = buildOffers({
      history: [consulta(88, '2026-08-17')],
      inquiries: [{ program_id: 88, consultaron: 5, compraron: 2 }],
      coPurchases: [],
      programs: [programa(88, 'NORMAL')],
      details: []
    })
    expect(o).toMatchObject({ kind: 'PIDIO', probability: null, edicion: null, precio: null })
  })

  it('no repite como sugerido lo que ya pidio, y no ofrece lo que ya compro', () => {
    const out = buildOffers({
      history: [consulta(88, '2026-08-17'), compra(27, '2025-12-29'), consulta(27, '2025-11-01')],
      inquiries: [{ program_id: 88, consultaron: 100, compraron: 20 }],
      coPurchases: [{ from_program: 27, to_program: 88, buyers: 100, next_buyers: 30 }],
      programs: [programa(88, 'NORMAL'), programa(27, 'TOP')],
      details: []
    })
    expect(out.map((o) => [o.kind, o.program_id])).toEqual([['PIDIO', 88]])
  })
})
