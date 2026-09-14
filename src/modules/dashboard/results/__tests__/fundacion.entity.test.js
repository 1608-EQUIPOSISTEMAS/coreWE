import { describe, it, expect } from 'vitest'
import { buildFundacionResults, eventProgress } from '../fundacion.entity.js'
import { TONE, RANKING_LIMIT } from '../results.entity.js'

// Lunes 14/09/2026: 10 días hábiles transcurridos de 22.
const NOW = new Date(2026, 8, 14, 12)

const evento = (dias, areas) => ({
  edition_num_id: 15933,
  evento: 'V CONGRESO',
  inicio: '05/09',
  dias,
  meta: { vip: 10, general: 11 },
  areas
})

const AREAS = [
  { area_code: '1.5', vip: '9', general: '9', virtual: '3' },
  { area_code: '1.1', vip: '2', general: '0', virtual: '1' }
]

const TRAMO = { ventas: 5, monto: 900, ventas_prev: 10, monto_prev: 900 }
const months = (values, build) => values.map((v, meses_atras) => ({ meses_atras, ...build(v) }))

const WIDGETS_POR_DISPOSICION = { hero: 2, mitad: 2, tercios: 3, completa: 1 }
const widgetsOf = (res) => res.filas.flatMap(f => f.widgets)
const widgetTitled = (res, titulo) => widgetsOf(res).find(w => w.titulo.startsWith(titulo))
const card = (res, label) => res.tarjetas.find(t => t.label.startsWith(label))

// Lo que el front da por sentado de cualquier panel.
function expectValidLayout (res) {
  expect(res.tarjetas).toHaveLength(4)
  for (const t of res.tarjetas) expect(t.icono).toMatch(/^fa-/)
  for (const fila of res.filas) {
    expect(fila.widgets).toHaveLength(WIDGETS_POR_DISPOSICION[fila.disposicion])
    for (const w of fila.widgets) {
      expect(w).toHaveProperty('insight')
      expect(w).toHaveProperty('verTodo')
      if (w.tipo === 'ranking') expect(w.items.length).toBeLessThanOrEqual(RANKING_LIMIT)
      if (w.tipo === 'grafico') {
        for (const s of w.grafico.series) expect(s.datos).toHaveLength(w.grafico.categorias.length)
      }
    }
  }
}

describe('eventProgress', () => {
  it('solo cuenta las entradas acreditadas a Fundación (1.5)', () => {
    expect(eventProgress(evento(20, AREAS))).toEqual([
      { categoria: 'VIP', real: 9, meta: 10 },
      { categoria: 'General', real: 9, meta: 11 }
    ])
  })
})

describe('buildFundacionResults con evento', () => {
  const becasPorMes = months([6, 10, 12, 12, 14, 0, 12], (becas) => ({ becas, certificado_pagado: becas === 6 ? 5 : 0 }))
  const programas = Array.from({ length: 7 }, (_, i) => ({ programa: `P${i}`, ventas: 7 - i, monto: 100 }))
  const res = buildFundacionResults({ tramo: TRAMO, becasPorMes, programas, evento: evento(20, AREAS) }, NOW)

  it('arma hero, mitad y tercios sin huecos', () => {
    expectValidLayout(res)
    expect(res.filas.map(f => f.disposicion)).toEqual(['hero', 'mitad', 'tercios'])
  })

  it('a más de una semana del evento informa el avance sin semáforo', () => {
    expect(card(res, 'Entradas')).toMatchObject({ valor: 18, comparativo: 'meta Fundación: 21', tono: null })
    expect(res.titular).toEqual({ texto: '18 de 21 entradas para V CONGRESO. Faltan 20 días.', tono: null })
  })

  it('el gráfico del evento dice qué categoría empujar', () => {
    const grafico = widgetTitled(res, '¿Cuánto falta')
    expect(grafico.grafico.series).toEqual([
      { nombre: 'Vendidas', datos: [9, 9], rol: 'principal' },
      { nombre: 'Meta', datos: [10, 11], rol: 'referencia' }
    ])
    expect(grafico.insight.texto).toBe('Faltan 20 días. A General le faltan 2 entradas.')
    expect(grafico.verTodo.ruta).toBe('/fundacion/eventos')
  })

  it('el medidor lleva al módulo de objetivos', () => {
    expect(widgetTitled(res, 'Avance de la meta')).toMatchObject({
      pct: 85.7,
      leyenda: [{ label: 'Vendidas', valor: 18, tono: TONE.OK }, { label: 'Faltan', valor: 3, tono: TONE.BAD }],
      verTodo: { ruta: '/fundacion/objetivos', texto: 'Ver objetivos' }
    })
  })

  it('la dona reparte las entradas de Fundación por categoría, sin segmentos en cero', () => {
    const dona = widgetTitled(res, 'Entradas por categoría')
    expect(dona.total).toBe(21)
    expect(dona.segmentos.map(s => s.label)).toEqual(['VIP', 'General', 'Virtual'])
  })

  it('el ranking se corta en el límite', () => {
    expect(widgetTitled(res, `Top ${RANKING_LIMIT}`).items).toHaveLength(RANKING_LIMIT)
  })

  it('becas: la proyección del mes contra la mediana, meses en cero incluidos', () => {
    // proyección = 6 / 10 hábiles × 22 = 13; mediana de [10,12,12,14,0,12] = 12
    expect(card(res, 'Becas')).toMatchObject({ comparativo: 'proyección 13, mediana 12 al mes', tono: TONE.OK })
    expect(widgetTitled(res, 'Becas').items[1]).toMatchObject({ label: 'Con certificado pagado', valor: 83.3 })
  })

  it('en la última semana el avance bajo se pinta de rojo, también en el titular', () => {
    const cerca = buildFundacionResults({ tramo: TRAMO, evento: evento(3, [{ area_code: '1.5', vip: '2', general: '1' }]) }, NOW)
    expect(card(cerca, 'Entradas').tono).toBe(TONE.BAD)
    expect(cerca.titular).toEqual({ texto: '3 de 21 entradas para V CONGRESO. Faltan 3 días.', tono: TONE.BAD })
  })

  it('evento ya pasado: el titular dice cuándo fue', () => {
    const pasado = buildFundacionResults({ tramo: TRAMO, evento: evento(-9, AREAS) }, NOW)
    expect(pasado.titular).toEqual({ texto: '18 de 21 entradas para V CONGRESO. Fue el 05/09.', tono: TONE.BAD })
  })
})

describe('buildFundacionResults sin evento', () => {
  it('el hero pasa a ventas por mes y el titular habla de las ventas', () => {
    const ventasPorMes = months([5, 20, 18, 22, 10, 0, 15], (ventas) => ({ ventas, monto: ventas * 100 }))
    const res = buildFundacionResults({ tramo: TRAMO, ventasPorMes, becasPorMes: [], programas: [] }, NOW)
    expectValidLayout(res)
    expect(res.filas[0].widgets.map(w => w.tipo)).toEqual(['grafico', 'comparativo'])
    expect(res.filas[0].widgets[0].titulo).toBe('¿Cuántas ventas hace Fundación por mes?')
    expect(card(res, 'Entradas')).toMatchObject({ valor: null, tono: null })
    expect(res.titular).toEqual({
      texto: '5 ventas en lo que va del mes, contra 10 en el mismo tramo del mes anterior.',
      tono: TONE.BAD
    })
  })

  it('sin datos de nada no deja widgets vacíos ni juzga', () => {
    const res = buildFundacionResults({}, NOW)
    expectValidLayout(res)
    expect(widgetsOf(res).some(w => w.tipo === 'grafico')).toBe(false)
    expect(res.titular.tono).toBeNull()
  })

  it('ingreso en cero se dice con palabras', () => {
    const res = buildFundacionResults({ tramo: { ventas: 0, monto: 0, ventas_prev: 3, monto_prev: 900 } }, NOW)
    expect(widgetTitled(res, 'Mes contra el anterior').insight.texto)
      .toBe('Todavía no hay ingreso este mes; a esta fecha del mes anterior iban S/ 900.')
  })
})
