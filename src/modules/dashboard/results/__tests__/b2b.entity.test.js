import { describe, it, expect } from 'vitest'
import { buildB2bResults } from '../b2b.entity.js'
import { row } from '../area-widgets.entity.js'
import { TONE, RANKING_LIMIT } from '../results.entity.js'

// Lunes 14/09/2026: 10 días hábiles transcurridos de 22.
const NOW = new Date(2026, 8, 14, 12)
const months = (values, build) => values.map((v, meses_atras) => ({ meses_atras, ...build(v) }))

const COBRANZA = months([[8917.5, 8917.5], [9000, 5276.8], [9823.75, 1000]],
  ([monto, alDia]) => ({ monto, monto_al_dia: alDia }))
const VENTAS = months([4, 46, 70, 143, 131, 11, 5],
  (ventas) => ({ ventas, monto: ventas * 100, cupos: ventas === 4 ? 2 : 0 }))
const LEADS = { leads: 20, pagados: 5, leads_prev: 20, pagados_prev: 10, leads_mes: 3 }
const PROGRAMAS = Array.from({ length: 6 }, (_, i) => ({ programa: `P${i}`, ventas: 6 - i, monto: 50 }))

const WIDGETS_POR_DISPOSICION = { hero: 2, mitad: 2, tercios: 3, completa: 1 }
const widgetsOf = (res) => res.filas.flatMap(f => f.widgets)
const widgetTitled = (res, titulo) => widgetsOf(res).find(w => w.titulo.startsWith(titulo))
const card = (res, label) => res.tarjetas.find(t => t.label.startsWith(label))

function expectValidLayout (res) {
  expect(res.tarjetas).toHaveLength(4)
  for (const t of res.tarjetas) expect(t.icono).toMatch(/^fa-/)
  for (const fila of res.filas) {
    expect(fila.widgets).toHaveLength(WIDGETS_POR_DISPOSICION[fila.disposicion])
    for (const w of fila.widgets) {
      if (w.tipo === 'ranking') expect(w.items.length).toBeLessThanOrEqual(RANKING_LIMIT)
      if (w.tipo === 'grafico') {
        for (const s of w.grafico.series) expect(s.datos).toHaveLength(w.grafico.categorias.length)
      }
    }
  }
}

describe('buildB2bResults', () => {
  const res = buildB2bResults({ cobranzaPorMes: COBRANZA, ventasPorMes: VENTAS, leads: LEADS, programas: PROGRAMAS }, NOW)

  it('arma hero, mitad y tercios con todos los datos', () => {
    expectValidLayout(res)
    expect(res.filas.map(f => f.disposicion)).toEqual(['hero', 'mitad', 'tercios'])
  })

  it('cobranza: del 1 al día de hoy contra el mismo tramo del mes anterior', () => {
    expect(card(res, 'Cobranza')).toMatchObject({ valor: 8917.5, tono: TONE.OK, icono: 'fa-hand-holding-dollar' })
    expect(card(res, 'Cobranza').ratio).toBeCloseTo(1.69, 2)
    expect(res.titular).toEqual({
      texto: 'Cobranza al día 14: S/ 8,918, 69% sobre el mismo tramo del mes anterior.',
      tono: TONE.OK
    })
  })

  it('el gráfico de cobranza va del mes más viejo al actual, que se rotula al día', () => {
    const { grafico, verTodo } = widgetTitled(res, '¿Cómo viene la cobranza?')
    expect(grafico.categorias).toEqual(['Jul', 'Ago', 'Sep (al día)'])
    expect(grafico.series[0].datos).toEqual([9823.75, 9000, 8917.5])
    expect(grafico.referencia).toEqual({ valor: 9411.875, etiqueta: 'mediana 6 meses' })
    expect(verTodo.ruta).toBe('/business/contracts')
  })

  it('ventas: la proyección del mes contra la mediana de 6 meses, y los cupos aparte', () => {
    // proyección = 4 / 10 × 22 = 9; mediana de [46,70,143,131,11,5] = 58
    expect(card(res, 'Ventas')).toMatchObject({ comparativo: 'proyección 9, mediana 58 al mes', tono: TONE.BAD })
    expect(card(res, 'Cupos')).toMatchObject({ valor: 2, tono: null, comparativo: 'de 4 ventas B2B del mes' })
    expect(widgetTitled(res, '¿Cómo se componen').segmentos).toEqual([
      { label: 'Con monto', valor: 2, tono: 'principal' },
      { label: 'Cupos en S/0', valor: 2, tono: 'neutro' }
    ])
  })

  it('conversión: medidor de 90 días contra los 90 previos, con salida a leads', () => {
    expect(card(res, 'Conversión')).toMatchObject({ valor: 25, ratio: 0.5, tono: TONE.BAD })
    expect(widgetTitled(res, 'Conversión')).toMatchObject({
      pct: 25,
      leyenda: [{ label: 'Pagados', valor: 5, tono: TONE.OK }, { label: 'Sin pago', valor: 15, tono: null }],
      verTodo: { ruta: '/b2b/leads', texto: 'Ver leads' }
    })
  })

  it('el ranking de programas se corta en el límite', () => {
    expect(widgetTitled(res, `Top ${RANKING_LIMIT}`).items).toHaveLength(RANKING_LIMIT)
  })

  it('sin cobros el titular lo dice con palabras', () => {
    const cobranzaPorMes = months([[0, 0], [9000, 5276.8]], ([monto, alDia]) => ({ monto, monto_al_dia: alDia }))
    expect(buildB2bResults({ cobranzaPorMes }, NOW).titular.texto)
      .toBe('Al día 14 todavía no hay cobros; a esta fecha del mes anterior iban S/ 5,277.')
  })

  it('sin datos no inventa porcentajes ni deja widgets vacíos', () => {
    const vacio = buildB2bResults({}, NOW)
    expectValidLayout(vacio)
    expect(card(vacio, 'Conversión')).toMatchObject({ valor: null, ratio: null, tono: null })
    expect(card(vacio, 'Cobranza')).toMatchObject({ valor: 0, ratio: null, tono: null })
    expect(widgetsOf(vacio).map(w => w.tipo)).toEqual(['ranking', 'metricas'])
    expect(vacio.titular.tono).toBeNull()
  })
})

describe('row', () => {
  it('saca los widgets en null y reacomoda la disposición', () => {
    expect(row('tercios', [{ tipo: 'a' }, null, { tipo: 'b' }])).toEqual({ disposicion: 'mitad', widgets: [{ tipo: 'a' }, { tipo: 'b' }] })
    expect(row('hero', [{ tipo: 'a' }, null])).toEqual({ disposicion: 'completa', widgets: [{ tipo: 'a' }] })
    expect(row('mitad', [null, null])).toBeNull()
  })
})
