import { describe, it, expect } from 'vitest'
import { buildProductoResults } from '../producto.entity.js'
import { TONE, RANKING_LIMIT, TABLE_LIMIT } from '../results.entity.js'

const HOY = new Date(2026, 8, 14, 12)
const DISPOSICIONES = ['hero', 'mitad', 'tercios', 'completa']
const widgets = (res) => res.filas.flatMap(f => f.widgets)
const widget = (res, titulo) => widgets(res).find(w => w.titulo.startsWith(titulo))

const raw = {
  proximas: [
    { edition_num_id: 1, programa: 'EXCEL BÁSICO', codigo_edicion: 'EX-01', fecha_inicio: '2026-09-17', dias: 3, ventas: 0, meta_ventas: 6 },
    { edition_num_id: 2, programa: 'SAP HANA FI', codigo_edicion: 'SAP-02', fecha_inicio: '2026-09-20', dias: 6, ventas: 12, meta_ventas: 18 },
    { edition_num_id: 3, programa: 'POWER BI', codigo_edicion: 'PB-03', fecha_inicio: '2026-10-10', dias: 26, ventas: 1, meta_ventas: 20 },
    { edition_num_id: 4, programa: 'SIN META', codigo_edicion: 'SM-04', fecha_inicio: '2026-09-18', dias: 4, ventas: 3, meta_ventas: 0 },
    { edition_num_id: 5, programa: 'SCRUM', codigo_edicion: 'SC-05', fecha_inicio: '2026-10-01', dias: 17, ventas: 22, meta_ventas: 20 }
  ],
  llenadoT14: [
    { mes: '2026-06', ediciones: 10, meta: 100, ventas: 48 },
    { mes: '2026-07', ediciones: 10, meta: 100, ventas: 43 },
    { mes: '2026-08', ediciones: 10, meta: 100, ventas: 52 },
    { mes: '2026-09', ediciones: 5, meta: 100, ventas: 23 }
  ],
  cancelacion: [
    { mes: '2026-07', cursos: 10, canceladas: 2 },
    { mes: '2026-08', cursos: 10, canceladas: 2 },
    { mes: '2026-09', cursos: 10, canceladas: 5 }
  ],
  planificacion: { sin_publicar: 2, primera: '2026-11-02' }
}

describe('buildProductoResults', () => {
  const res = buildProductoResults(raw, HOY)

  it('arma el panel ejecutivo: 4 tarjetas con icono y filas con disposiciones válidas', () => {
    expect(res.tarjetas).toHaveLength(4)
    expect(res.tarjetas.every(t => t.icono?.startsWith('fa-'))).toBe(true)
    expect(res.filas.map(f => f.disposicion)).toEqual(DISPOSICIONES)
    expect(res.filas.find(f => f.disposicion === 'tercios').widgets).toHaveLength(3)
    for (const w of widgets(res)) expect(w).toMatchObject({ tipo: expect.any(String), titulo: expect.stringMatching(/^¿/) })
  })

  it('el titular pone el riesgo primero y suma el llenado a 14 días contra lo típico', () => {
    expect(res.titular).toEqual({
      texto: '1 edición puede caerse en las próximas 2 semanas. Llegan a 14 días del inicio con 23% de la meta; lo típico es 48%.',
      tono: TONE.BAD
    })
  })

  it('tarjetas: llenado sin semáforo, T-14 y cancelación contra su referencia', () => {
    const [proximas, t14, riesgo, cancel] = res.tarjetas
    expect(proximas).toMatchObject({ valor: 54.7, tono: null, comparativo: '35 de 64 vacantes en 4 ediciones' })
    expect(t14).toMatchObject({ valor: 23, tono: TONE.BAD })
    expect(riesgo).toMatchObject({ valor: 1, tono: TONE.BAD })
    expect(cancel).toMatchObject({ valor: 50, tono: TONE.BAD })
    expect(cancel.comparativo).toBe('promedio 6 meses: 20%, 5 de 10 cursos')
  })

  it('hero: llenado a 14 días por mes con el típico, y comparativo honesto', () => {
    const grafico = widget(res, '¿Llegamos a los 14 días').grafico
    expect(grafico.categorias).toEqual(['Jun', 'Jul', 'Ago', 'Sep'])
    expect(grafico.series[0].datos).toHaveLength(grafico.categorias.length)
    expect(grafico.referencia).toEqual({ valor: 48, etiqueta: 'típico' })
    const cmp = widget(res, '¿Cómo va el llenado')
    expect(cmp).toMatchObject({ tipo: 'comparativo', valor: 23, tono: TONE.BAD })
    expect(cmp.barras.map(b => [b.actual, b.anterior])).toEqual([[23, 48], [35, 64]])
    expect(cmp.insight.texto).toBe('Faltan 29 ventas para llenar las 4 ediciones de los próximos 30 días.')
  })

  it('ranking de riesgo: solo lo cercano, con meta y bajo el 50%; se corta en el límite', () => {
    expect(widget(res, '¿Qué ediciones pueden').items).toEqual([
      { label: 'EXCEL BÁSICO', sublabel: 'inicia el 17/09, 0 de 6', valor: 0, tono: TONE.BAD, ruta: null }
    ])
    const muchas = Array.from({ length: 8 }, (_, i) => ({ edition_num_id: i, programa: `P${i}`, fecha_inicio: '2026-09-20', dias: 6, ventas: 0, meta_ventas: 10 }))
    const ranking = widget(buildProductoResults({ proximas: muchas }, HOY), '¿Qué ediciones pueden')
    expect(ranking.items).toHaveLength(RANKING_LIMIT)
    expect(ranking.insight.texto).toBe('Hay 3 ediciones más en riesgo.')
  })

  it('dona por bandas de llenado; lo que no tiene meta queda fuera con aviso', () => {
    const dona = widget(res, '¿Cómo vienen las ediciones')
    expect(dona.total).toBe(4)
    expect(dona.segmentos.map(s => [s.tono, s.valor])).toEqual([[TONE.OK, 1], [TONE.WARN, 1], [TONE.BAD, 2]])
    expect(dona.insight.texto).toBe('1 edición no tiene meta cargada y no entran aquí.')
  })

  it('tercios: cancelación por mes con promedio, medidor y métricas de planificación', () => {
    expect(widget(res, '¿Cuántas ediciones se cancelan').grafico.referencia).toEqual({ valor: 20, etiqueta: 'promedio 6 meses' })
    expect(widget(res, '¿Cuánto de los próximos')).toMatchObject({ tipo: 'medidor', pct: 54.7, tono: null })
    expect(widget(res, '¿Qué falta preparar').items.map(i => i.valor)).toEqual([2, '02/11', 1])
  })

  it('tabla de las que inician en 14 días: por fecha, con tono por banda', () => {
    const tabla = widget(res, '¿Cómo llegan las que inician')
    expect(tabla.filas.map(f => [f.dias, f.tono_llenado])).toEqual([[3, TONE.BAD], [4, null], [6, TONE.WARN]])
    const muchas = Array.from({ length: 13 }, (_, i) => ({ edition_num_id: i, programa: 'X', fecha_inicio: '2026-09-20', dias: i, ventas: 1, meta_ventas: 10 }))
    expect(widget(buildProductoResults({ proximas: muchas }, HOY), '¿Cómo llegan las que inician').filas).toHaveLength(TABLE_LIMIT)
  })

  it('sin histórico no inventa semáforo', () => {
    const vacio = buildProductoResults({}, HOY)
    expect(vacio.tarjetas[1]).toMatchObject({ valor: null, tono: null, comparativo: 'sin histórico' })
    expect(vacio.tarjetas[2].tono).toBe(TONE.OK)
    expect(vacio.titular).toEqual({ texto: 'Ninguna edición de las próximas 2 semanas está en riesgo.', tono: TONE.OK })
    expect(widget(vacio, '¿Llegamos a los 14 días')).toMatchObject({ insight: null, grafico: { categorias: [], referencia: null } })
  })
})
