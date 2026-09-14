import { describe, it, expect } from 'vitest'
import { buildFicoResults, backlogTone } from '../fico.entity.js'
import { RANKING_LIMIT, TABLE_LIMIT } from '../results.entity.js'

const NOW = new Date(2026, 8, 14, 12) // 10 de 22 días hábiles

const raw = (over = {}) => ({
  bandeja: { total: 0, menor_24h: 0, de_1_a_3: 0, mayor_3: 0 },
  ritmo: { hoy: 0, muestras: [] },
  tiempo: { horas_mes: null, horas_prev: null },
  ingreso: { mes: 0, prev_tramo: 0, meses_previos: [] },
  porVencer: { cuotas: 0, monto: 0 },
  morosidad: { actual: { vencido: 0, impago: 0 }, prev: { vencido: 0, impago: 0 } },
  equipo: [],
  pendientes: [],
  aprobaciones: { mes: 0, prev_tramo: 0 },
  ...over
})
const build = (over) => buildFicoResults(raw(over), NOW)
const card = (res, label) => res.tarjetas.find(t => t.label === label)
const widget = (res, titulo) => res.filas.flatMap(f => f.widgets).find(w => w.titulo === titulo)

describe('backlogTone', () => {
  it('sin atrasados es verde; atraso chico ámbar; atraso que domina rojo', () => {
    expect(backlogTone({ total: 10, mayor_3: 0 })).toBe('ok')
    expect(backlogTone({ total: 10, mayor_3: 2 })).toBe('warn')
    expect(backlogTone({ total: 10, mayor_3: 6 })).toBe('bad')
  })
})

describe('estructura del panel', () => {
  it('4 tarjetas con icono y filas hero, mitad, tercios y completa con sus widgets', () => {
    const res = build()
    expect(res.tarjetas.map(t => t.label)).toEqual(['Bandeja por validar', 'Aprobadas hoy', 'Ingreso del mes', 'Morosidad 90 días'])
    res.tarjetas.forEach(t => expect(t.icono).toMatch(/^fa-/))
    expect(res.filas.map(f => [f.disposicion, f.widgets.length])).toEqual([['hero', 2], ['mitad', 2], ['tercios', 3], ['completa', 1]])
    expect(res.filas.flatMap(f => f.widgets.map(w => w.tipo)))
      .toEqual(['grafico', 'comparativo', 'grafico', 'dona', 'ranking', 'medidor', 'metricas', 'tabla'])
  })
})

describe('bandeja', () => {
  it('tarjeta en rojo cuando domina lo que lleva más de 3 días', () => {
    expect(card(build({ bandeja: { total: 71, menor_24h: 3, de_1_a_3: 2, mayor_3: 66 } }), 'Bandeja por validar'))
      .toMatchObject({ valor: 71, tono: 'bad', comparativo: '66 con más de 3 días' })
  })

  it('gráfico por antigüedad con insight y enlace a la bandeja', () => {
    const w = widget(build({ bandeja: { total: 6, menor_24h: 1, de_1_a_3: 2, mayor_3: 3 } }), '¿Cuánto espera la bandeja?')
    expect(w.grafico).toMatchObject({ tipo: 'barras-h', categorias: ['De hoy', 'De 1 a 3 días', 'Más de 3 días'] })
    expect(w.grafico.series[0].datos).toEqual([1, 2, 3])
    expect(w.insight).toEqual({ texto: '6 ventas esperan validación y 3 llevan más de 3 días.', tono: 'bad' })
    expect(w.verTodo.ruta).toBe('/fico/inscripciones')
  })

  it('medidor: qué parte de la bandeja está al día', () => {
    const w = widget(build({ bandeja: { total: 10, menor_24h: 5, de_1_a_3: 3, mayor_3: 2 } }), '¿Qué parte de la bandeja está al día?')
    expect(w).toMatchObject({ pct: 80, tono: 'warn' })
    expect(w.leyenda.map(l => l.valor)).toEqual([8, 2])
  })

  it('tabla de las más antiguas: límite, días en rojo y ruta a cada inscripción', () => {
    const pendientes = Array.from({ length: 12 }, (_, i) => ({
      enrollment_id: 2247 + i, alumno: `Alumno ${i}`, programa: 'FWD', asesor: 'AE30', dias: i === 0 ? 124 : 2
    }))
    const w = widget(build({ pendientes }), 'Ventas que más esperan')
    expect(w.filas).toHaveLength(TABLE_LIMIT)
    expect(w.filas[0]).toMatchObject({ dias: 124, tono_dias: 'bad', ruta: '/fico/inscripciones/2247' })
    expect(w.filas[1].tono_dias).toBeNull()
    expect(w.verTodo).toEqual({ ruta: '/fico/inscripciones', texto: 'Ver bandeja' })
  })
})

describe('ingreso y cobranza', () => {
  it('veredicto: la bandeja atascada manda el tono aunque el ingreso vaya bien', () => {
    expect(build({
      bandeja: { total: 71, menor_24h: 0, de_1_a_3: 0, mayor_3: 71 },
      ingreso: { mes: 112000, prev_tramo: 100000, meses_previos: [] }
    }).titular).toEqual({
      texto: '71 ventas esperan validación y 71 llevan más de 3 días. El ingreso va 12% sobre el mismo tramo del mes anterior.',
      tono: 'bad'
    })
  })

  it('veredicto: bandeja al día e ingreso algo bajo es ámbar; sin tramo anterior no inventa comparación', () => {
    expect(build({ ingreso: { mes: 95, prev_tramo: 100, meses_previos: [] } }).titular)
      .toEqual({ texto: 'La bandeja está al día. El ingreso va 5% bajo el mismo tramo del mes anterior.', tono: 'warn' })
    expect(build().titular).toEqual({ texto: 'La bandeja está al día.', tono: 'ok' })
  })

  it('curva de ingreso: acumula por día, corta en hoy y el mes anterior se queda en su total', () => {
    const { grafico } = widget(build({
      ingresoDiario: [
        { mes: 'actual', dia: 1, soles: 100 }, { mes: 'actual', dia: 3, soles: 50 },
        { mes: 'prev', dia: 2, soles: 40 }, { mes: 'prev', dia: 28, soles: 60 }
      ]
    }), '¿Cómo va el ingreso del mes?')
    expect(grafico.categorias).toHaveLength(30)
    grafico.series.forEach(s => expect(s.datos).toHaveLength(30))
    const [actual, prev] = grafico.series.map(s => s.datos)
    expect(actual.slice(0, 4)).toEqual([100, 100, 150, 150])
    expect(actual[13]).toBe(150)
    expect(actual[14]).toBeNull()
    expect(prev[0]).toBe(0)
    expect(prev[29]).toBe(100)
  })

  it('tarjeta y comparativo de ingreso contra el mismo tramo, con proyección por días hábiles', () => {
    const res = build({
      ingreso: { mes: 100000, prev_tramo: 120000, meses_previos: [206000, 262000, 314000] },
      aprobaciones: { mes: 40, prev_tramo: 50 }
    })
    const tarjeta = card(res, 'Ingreso del mes')
    expect(tarjeta.tono).toBe('bad')
    expect(tarjeta.ratio).toBeCloseTo(0.833, 2)
    const w = widget(res, 'Ingreso contra el mes anterior')
    expect(w.barras[1]).toEqual({ label: 'Aprobadas del mes', actual: 40, anterior: 50, unidad: 'num' })
    expect(w.insight.texto).toContain('220')
    expect(w.insight.tono).toBe('bad') // proyección 220 mil contra mediana de 262 mil
  })

  it('morosidad que sube respecto de hace un mes es mala; sin base no hay semáforo', () => {
    const sube = { morosidad: { actual: { vencido: 1000, impago: 30 }, prev: { vencido: 1000, impago: 18 } } }
    expect(card(build(sube), 'Morosidad 90 días')).toMatchObject({ valor: 3, tono: 'bad' })
    expect(card(build(), 'Morosidad 90 días').tono).toBeNull()
  })

  it('dona de lo vencido: cobrado contra sin pagar, con la morosidad en el insight', () => {
    const w = widget(build({ morosidad: { actual: { vencido: 1000, impago: 30 }, prev: { vencido: 1000, impago: 18 } } }), '¿Cuánto de lo vencido se cobró?')
    expect(w.segmentos.map(s => [s.label, s.valor, s.tono])).toEqual([['Cobrado', 970, 'ok'], ['Sin pagar', 30, 'bad']])
    expect(w.insight).toEqual({ texto: 'Morosidad de 3%; hace un mes era 1.8%.', tono: 'bad' })
    expect(widget(build(), '¿Cuánto de lo vencido se cobró?').insight.texto).toBe('Sin cuotas vencidas en los últimos 90 días.')
  })

  it('tiempo de aprobación en las métricas: bajar respecto del mes anterior es verde', () => {
    const w = widget(build({ tiempo: { horas_mes: 2.37, horas_prev: 4 } }), 'Cobranza y validación')
    expect(w.items.find(i => i.label === 'Tiempo de aprobación'))
      .toMatchObject({ valor: 2.4, tono: 'ok', nota: 'mes anterior: 4 h' })
  })
})

describe('equipo', () => {
  it('ranking: solo quien aprobó, ordenado, con límite', () => {
    const equipo = [
      { user_id: 1, name: 'Elma', alias: 'ELMA', aprobadas_hoy: 2, aprobadas_mes: 30, observadas_mes: 1, horas: 2.345 },
      { user_id: 2, name: 'Raul', alias: 'RAFI', aprobadas_hoy: 5, aprobadas_mes: 80, observadas_mes: 0, horas: null },
      { user_id: 3, name: 'Lider', alias: 'LIFI', aprobadas_hoy: 0, aprobadas_mes: 0, observadas_mes: 0, horas: null },
      ...Array.from({ length: 6 }, (_, i) => ({ user_id: 10 + i, name: `P${i}`, alias: `P${i}`, aprobadas_mes: 5 + i, observadas_mes: 0, horas: null }))
    ]
    const w = widget(build({ equipo }), `Top ${RANKING_LIMIT} del equipo FICO`)
    expect(w.items).toHaveLength(RANKING_LIMIT)
    expect(w.items.slice(0, 2).map(i => i.valor)).toEqual([80, 30])
    expect(w.items[1].sublabel).toBe('2.3 h de mediana, 1 observadas')
  })
})
