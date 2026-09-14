import { describe, it, expect } from 'vitest'
import { buildComercialResults } from '../comercial.entity.js'
import { RANKING_LIMIT, TABLE_LIMIT } from '../results.entity.js'

// Lunes 14/09/2026: 10 de 22 días hábiles transcurridos (45% del mes).
const NOW = new Date(2026, 8, 14, 12)

const asesor = (over) => ({
  user_id: 1, name: 'Camila', alias: 'CA36', hoy: 0, mes: 0, mes_prev: 0, mes_prev_tramo: 0,
  observadas: 0, observadas_prev: 0, meta: null, consultas: 0, pagadas: 0, sin_gestion: 0, ...over
})

// Filas del GROUPING SETS de seguimiento: por asesor y del equipo (user_id null).
const seg = (over) => ({ user_id: null, reciente: true, consultas: 0, con_seguimiento: 0, en_24h: 0, horas_primer_contacto: null, ...over })

const build = (raw) => buildComercialResults({ ritmo: { hoy: 0, muestras: [] }, asesores: [], conversionHistorica: [], ...raw }, NOW)
const card = (res, label) => res.tarjetas.find(t => t.label === label)
const widget = (res, titulo) => res.filas.flatMap(f => f.widgets).find(w => w.titulo === titulo)

describe('estructura del panel', () => {
  it('4 tarjetas con icono y filas hero, mitad, tercios y completa con sus widgets', () => {
    const res = build({})
    expect(res.tarjetas).toHaveLength(4)
    res.tarjetas.forEach(t => expect(t.icono).toMatch(/^fa-/))
    expect(res.filas.map(f => [f.disposicion, f.widgets.length])).toEqual([['hero', 2], ['mitad', 2], ['tercios', 3], ['completa', 1]])
    expect(res.filas.flatMap(f => f.widgets.map(w => w.tipo)))
      .toEqual(['grafico', 'comparativo', 'grafico', 'dona', 'ranking', 'medidor', 'metricas', 'tabla'])
    res.filas.flatMap(f => f.widgets).forEach(w => {
      expect(w).toHaveProperty('pista')
      expect(w).toHaveProperty('insight')
      expect(w).toHaveProperty('verTodo')
    })
  })

  it('ranking y tabla respetan sus límites y la tabla lleva a las consultas', () => {
    const asesores = Array.from({ length: 12 }, (_, i) => asesor({ user_id: i + 1, alias: `A${i}`, mes: i + 1 }))
    const res = build({ asesores })
    const ranking = widget(res, `Top ${RANKING_LIMIT} asesores del mes`)
    expect(ranking.items).toHaveLength(RANKING_LIMIT)
    expect(ranking.items.map(i => i.valor)).toEqual([12, 11, 10, 9, 8])
    const tabla = widget(res, 'Asesores')
    expect(tabla.filas).toHaveLength(TABLE_LIMIT)
    expect(tabla.verTodo).toEqual({ ruta: '/comercial/leads', texto: 'Ver consultas' })
  })
})

describe('tarjetas', () => {
  it('ritmo del día: por encima de lo típico a esta hora es verde; sin histórico no hay semáforo', () => {
    expect(card(build({ ritmo: { hoy: 12, muestras: [8, 10, 11] } }), 'Enviadas a FICO hoy'))
      .toMatchObject({ valor: 12, ratio: 1.2, tono: 'ok', comparativo: 'típico a esta hora: 10' })
    expect(card(build({ ritmo: { hoy: 4, muestras: [10] } }), 'Enviadas a FICO hoy').tono).toBe('bad')
    expect(card(build({ ritmo: { hoy: 4, muestras: [] } }), 'Enviadas a FICO hoy').tono).toBeNull()
  })

  it('con meta: se juzga contra lo esperado a la fecha y proyecta el cierre', () => {
    const res = build({ asesores: [asesor({ mes: 50, meta: 100 }), asesor({ user_id: 2, mes: 20, meta: 60 })] })
    expect(card(res, 'Ventas del mes')).toMatchObject({
      valor: 70, tono: 'warn', comparativo: 'meta 160, proyección al cierre 154'
    })
  })

  it('sin meta: compara contra el mismo tramo del mes anterior', () => {
    expect(card(build({ asesores: [asesor({ mes: 30, mes_prev_tramo: 40 })] }), 'Ventas del mes'))
      .toMatchObject({ ratio: 0.75, tono: 'bad', comparativo: 'mismo tramo del mes anterior: 40' })
  })
})

describe('widgets de venta', () => {
  it('comparativo del mes: barras actual contra anterior y proyección contra la meta', () => {
    const w = widget(build({ asesores: [asesor({ mes: 70, meta: 160, mes_prev_tramo: 60 })] }), 'Mes contra el anterior')
    expect(w).toMatchObject({ valor: 70, unidad: 'num', tono: 'ok' })
    expect(w.barras[0]).toEqual({ label: 'Ventas', actual: 70, anterior: 60, unidad: 'num' })
    expect(w.insight).toEqual({ texto: 'Al ritmo actual cierran con 154 ventas, 96% de la meta de 160.', tono: 'warn' })
  })

  it('observadas en calidad del envío: subir la tasa respecto del mes anterior es malo', () => {
    const w = widget(build({ asesores: [asesor({ mes: 20, observadas: 4, mes_prev: 40, observadas_prev: 4 })] }), 'Calidad del envío')
    expect(w.items[0]).toMatchObject({ label: 'Observadas por FICO', valor: 20, tono: 'bad', nota: 'mes anterior: 10%' })
  })

  it('medidor de conversión contra la mediana de los 3 meses anteriores', () => {
    const w = widget(build({
      asesores: [asesor({ consultas: 100, pagadas: 15 })],
      conversionHistorica: [{ consultas: 100, pagadas: 12 }, { consultas: 100, pagadas: 12 }, { consultas: 100, pagadas: 16 }]
    }), 'Conversión consulta → venta')
    expect(w).toMatchObject({ pct: 15, tono: 'ok', insight: { texto: 'Mediana de los 3 meses anteriores: 12%.', tono: 'ok' } })
  })

  it('tabla de asesores: semáforo individual, ordenada por ventas y sin filas vacías', () => {
    const filas = widget(build({
      asesores: [asesor({ alias: 'TM41', mes: 10, meta: 100 }), asesor({ alias: 'SF13', mes: 60, meta: 100 }), asesor({ alias: 'LIDER' })]
    }), 'Asesores').filas
    expect(filas.map(f => f.asesor.split(' ')[0])).toEqual(['SF13', 'TM41'])
    expect(filas[0]).toMatchObject({ avance: 60, tono_avance: 'ok', proyeccion: 132 })
    expect(filas[1].tono_avance).toBe('bad')
  })
})

describe('seguimiento a clientes', () => {
  const asesores = [asesor({ user_id: 1, alias: 'CA36' }), asesor({ user_id: 2, alias: 'TM41' })]
  const seguimiento = [
    seg({ user_id: 1, consultas: 50, con_seguimiento: 40, en_24h: 30 }),
    seg({ user_id: 2, consultas: 50, con_seguimiento: 10, en_24h: 5 }),
    seg({ consultas: 100, con_seguimiento: 50, en_24h: 35, horas_primer_contacto: 6.25 }),
    seg({ reciente: false, consultas: 100, con_seguimiento: 40, en_24h: 40 })
  ]

  it('tarjeta del equipo contra los 30 días anteriores; sin tramo anterior no hay semáforo', () => {
    expect(card(build({ asesores, seguimiento }), 'Consultas con seguimiento'))
      .toMatchObject({ valor: 50, comparativo: '30 días antes: 40%', tono: 'ok' })
    expect(card(build({ asesores, seguimiento: seguimiento.slice(0, 3) }), 'Consultas con seguimiento'))
      .toMatchObject({ valor: 50, ratio: null, tono: null })
  })

  it('dona: en 24 h, después y sin contacto, con la mediana al primer contacto', () => {
    const w = widget(build({ asesores, seguimiento }), '¿Cómo se atienden las consultas?')
    expect(w).toMatchObject({ total: 100, etiquetaTotal: 'consultas' })
    expect(w.segmentos.map(s => [s.valor, s.tono])).toEqual([[35, 'ok'], [15, 'warn'], [50, 'bad']])
    expect(w.insight).toEqual({ texto: 'El primer contacto llega a las 6.3 h (mediana).', tono: 'bad' })
  })

  it('gráfico por asesor: ordenado, con la línea del promedio y señalando al más bajo', () => {
    const w = widget(build({ asesores, seguimiento }), '¿Quién le da seguimiento a sus consultas?')
    expect(w.grafico).toMatchObject({ tipo: 'barras-h', categorias: ['CA36', 'TM41'], referencia: { valor: 50 } })
    expect(w.grafico.series[0].datos).toEqual([80, 20])
    expect(w.insight).toEqual({ texto: 'TM41 es quien menos seguimiento da: 20% contra 50% del equipo.', tono: 'bad' })
  })

  it('si todos están en el promedio (p.ej. todos en 0%) no se señala a nadie', () => {
    const planos = [
      seg({ user_id: 1, consultas: 10 }), seg({ user_id: 2, consultas: 10 }), seg({ consultas: 20 })
    ]
    expect(widget(build({ asesores, seguimiento: planos }), '¿Quién le da seguimiento a sus consultas?').insight).toBeNull()
  })

  it('tabla: cada asesor contra el promedio del equipo', () => {
    const filas = widget(build({ asesores, seguimiento }), 'Asesores').filas
    expect(filas.find(f => f.asesor.startsWith('CA36')))
      .toMatchObject({ seguimiento: 80, tono_seguimiento: 'ok', en_24h: 60, tono_en_24h: 'ok' })
    expect(filas.find(f => f.asesor.startsWith('TM41'))).toMatchObject({ seguimiento: 20, tono_seguimiento: 'bad' })
  })
})

describe('titular y ritmo por hora', () => {
  it('con meta: el día y el cierre del mes, con el tono del mes', () => {
    const res = build({ ritmo: { hoy: 38, muestras: [34] }, asesores: [asesor({ mes: 70, meta: 160 })] })
    expect(res.titular).toEqual({
      texto: 'Van 38 ventas hoy, 12% sobre lo típico a esta hora. Al ritmo actual cierran el mes en 96% de la meta.',
      tono: 'warn'
    })
  })

  it('sin meta: el mes contra el mismo tramo del mes anterior', () => {
    const res = build({ ritmo: { hoy: 0, muestras: [5] }, asesores: [asesor({ mes: 30, mes_prev_tramo: 40 })] })
    expect(res.titular).toEqual({
      texto: 'Hoy todavía no hay ventas. En el mes van 30, 25% bajo el mismo tramo del mes anterior (40).',
      tono: 'bad'
    })
  })

  it('sin ventas en el mes: una sola frase, sin repetir el día', () => {
    expect(build({ ritmo: { hoy: 0, muestras: [5] }, asesores: [asesor({ mes_prev_tramo: 40 })] }).titular)
      .toEqual({ texto: 'En el mes todavía no hay ventas; a esta fecha del mes anterior iban 40.', tono: 'bad' })
  })

  it('la curva de hoy se corta en las horas que no llegaron y mide lo mismo que el típico', () => {
    const ritmoPorHora = [{ hora: 8, hoy: 1, tipico: 0.5 }, { hora: 9, hoy: 3, tipico: 2 }, { hora: 10, hoy: null, tipico: 4 }]
    const { grafico } = widget(build({ ritmoPorHora }), '¿Vamos bien hoy?')
    expect(grafico.categorias).toEqual(['8 h', '9 h', '10 h'])
    expect(grafico.series.map(s => s.datos)).toEqual([[1, 3, null], [0.5, 2, 4]])
    grafico.series.forEach(s => expect(s.datos).toHaveLength(grafico.categorias.length))
  })
})
