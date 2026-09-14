import { describe, it, expect } from 'vitest'
import { buildAcademicaResults, sessionCompliance } from '../academica.entity.js'
import { TONE, RANKING_LIMIT, TABLE_LIMIT } from '../results.entity.js'

const HOY = new Date(2026, 8, 14, 12)
const DISPOSICIONES = ['hero', 'mitad', 'tercios', 'completa']
const widgets = (res) => res.filas.flatMap(f => f.widgets)
const widget = (res, titulo) => widgets(res).find(w => w.titulo.startsWith(titulo))

const seguimiento = {
  date_start: '2026-08-15',
  editions: [
    {
      edition_num_id: 10,
      instructor: 'Ana Pérez',
      sessions: [
        { date: '2026-08-01', status: null }, // antes de la ventana: no cuenta
        { date: '2026-09-01', status: 'A' },
        { date: '2026-09-08', status: 'T' },
        { date: '2026-09-10', status: null }, // debida y sin registrar
        { date: '2026-09-14', status: null } // hoy: todavía no se debe
      ]
    },
    {
      edition_num_id: 11,
      instructor: null,
      sessions: [
        { date: '2026-09-03', status: 'R' }, // reprogramada a una fecha pasada y no marcada
        { date: '2026-09-30', status: 'R' } // reprogramada al futuro
      ]
    }
  ]
}

const raw = {
  aulasSemana: [
    { semana: 'actual', edition_num_id: 10, programa: 'POWER BI', codigo: 'BI-CP-03 E4-26', sin_docente: false, inicia: true, termina: false },
    { semana: 'actual', edition_num_id: 11, programa: 'EXCEL', codigo: 'EX-01 E2-26', sin_docente: true, inicia: false, termina: true },
    { semana: 'actual', edition_num_id: 12, programa: 'SAP FI', codigo: 'SA-01 E1-26', sin_docente: false, inicia: false, termina: false },
    { semana: 'hace_4', edition_num_id: 9, sin_docente: false, inicia: false, termina: false }
  ],
  aulaMetricas: [{ edition_num_id: 10, cnt_aula: 20 }, { edition_num_id: 12, cnt_aula: 5 }], // 11 sin roster = 0 alumnos
  aulasFinalizadas: [
    { edition_num_id: 5, programa: 'GESTIÓN', codigo: 'PC-01 E6-26', fin: '2026-09-10', alumnos: 15, con_nota: 12, aprobados: 10, certificados: 4 },
    { edition_num_id: 6, programa: 'ANALISTA', codigo: 'PC-02 E4-26', fin: '2026-09-01', alumnos: 9, con_nota: 0, aprobados: 0, certificados: 0 },
    { edition_num_id: 7, programa: 'SCRUM', codigo: 'SC-01 E3-26', fin: '2026-09-11', alumnos: 12, con_nota: 0, aprobados: 0, certificados: 0 }
  ],
  seguimiento
}

describe('sessionCompliance', () => {
  it('cuenta solo lo debido dentro de la ventana; A y T son registradas', () => {
    const r = sessionCompliance(seguimiento, '2026-09-14')
    expect(r).toMatchObject({ debidas: 4, registradas: 2 })
    expect(r.docentes).toEqual([
      { docente: 'Ana Pérez', aulas: 1, pendientes: 1, mas_antigua: '10/09' },
      { docente: 'Sin docente', aulas: 1, pendientes: 1, mas_antigua: '03/09' }
    ])
  })
})

describe('buildAcademicaResults', () => {
  const res = buildAcademicaResults(raw, HOY)

  it('arma el panel ejecutivo: 4 tarjetas con icono y filas con disposiciones válidas', () => {
    expect(res.tarjetas).toHaveLength(4)
    expect(res.tarjetas.every(t => t.icono?.startsWith('fa-'))).toBe(true)
    expect(res.filas.map(f => f.disposicion)).toEqual(DISPOSICIONES)
    expect(res.filas.find(f => f.disposicion === 'hero').widgets).toHaveLength(2)
    expect(res.filas.find(f => f.disposicion === 'tercios').widgets).toHaveLength(3)
    for (const w of widgets(res)) expect(w).toMatchObject({ tipo: expect.any(String), titulo: expect.stringMatching(/^¿/) })
  })

  it('el titular dice cuánto está registrado y cuántos docentes deben', () => {
    expect(res.titular).toEqual({
      texto: 'El 50% de las sesiones de los últimos 30 días está registrado. 2 docentes tienen clases sin registrar.',
      tono: TONE.BAD
    })
  })

  it('tarjetas: aulas contra hace 4 semanas sin semáforo; notas y certificados con tono', () => {
    const [aulas, sesiones, notas, certificados] = res.tarjetas
    expect(aulas).toMatchObject({ valor: 3, tono: null, comparativo: 'hace 4 semanas: 1' })
    expect(sesiones).toMatchObject({ valor: 50, tono: TONE.BAD })
    expect(notas).toMatchObject({ valor: 33.3, comparativo: '1 de 3 finalizadas en 60 días' })
    expect(certificados).toMatchObject({ valor: 6, comparativo: '4 de 10 aprobados certificados' })
  })

  it('hero: registro por semana ISO y medidor de lo registrado', () => {
    const grafico = widget(res, '¿Se están registrando').grafico
    // 01/09 y 03/09 caen en la semana del lunes 31/08; 08/09 y 10/09 en la del 07/09.
    expect(grafico.categorias).toEqual(['Sem. 31/08', 'Sem. 07/09'])
    expect(grafico.series.map(s => [s.rol, s.datos])).toEqual([['principal', [1, 1]], ['referencia', [1, 1]]])
    expect(widget(res, '¿Qué parte de lo dictado')).toMatchObject({
      tipo: 'medidor', pct: 50, leyenda: [{ label: 'registradas', valor: 2 }, { label: 'sin registrar', valor: 2 }]
    })
  })

  it('el ranking de docentes se corta en el límite y manda al seguimiento', () => {
    const muchos = {
      date_start: '2026-08-15',
      editions: Array.from({ length: 7 }, (_, i) => ({
        edition_num_id: 100 + i, instructor: `Docente ${i}`, sessions: [{ date: '2026-09-02', status: null }]
      }))
    }
    const ranking = widget(buildAcademicaResults({ seguimiento: muchos }, HOY), '¿Qué docentes')
    expect(ranking.items).toHaveLength(RANKING_LIMIT)
    expect(ranking.verTodo.ruta).toBe('/academica/reporte')
    expect(ranking.insight.texto).toBe('Y 2 docentes más con clases pendientes.')
  })

  it('dona: cada aula en un solo momento y aviso de aulas sin docente', () => {
    const dona = widget(res, '¿En qué momento')
    expect(dona.total).toBe(3)
    expect(dona.segmentos.map(s => s.valor)).toEqual([1, 1, 1])
    expect(dona.insight.texto).toBe('1 aula no tiene docente asignado.')
  })

  it('aulas chicas: de menor a mayor, con ruta al aula', () => {
    const ranking = widget(res, '¿Qué aulas en curso')
    expect(ranking.items.map(i => [i.label, i.valor, i.ruta])).toEqual([
      ['EXCEL', 0, '/academica/aulas/11'],
      ['SAP FI', 5, '/academica/aulas/12']
    ])
  })

  it('tabla de aulas sin notas: las más viejas primero, con días y ruta', () => {
    const tabla = widget(res, '¿Qué aulas cerraron')
    expect(tabla.filas.map(f => [f.codigo, f.dias, f.tono_dias, f.ruta])).toEqual([
      ['PC-02 E4-26', 13, TONE.BAD, '/academica/aulas/6'],
      ['SC-01 E3-26', 3, TONE.WARN, '/academica/aulas/7']
    ])
    const muchas = Array.from({ length: 14 }, (_, i) => ({ edition_num_id: i, programa: 'X', codigo: `C${i}`, fin: '2026-09-01', alumnos: 1, con_nota: 0, aprobados: 0, certificados: 0 }))
    const larga = widget(buildAcademicaResults({ aulasFinalizadas: muchas }, HOY), '¿Qué aulas cerraron')
    expect(larga.filas).toHaveLength(TABLE_LIMIT)
    expect(larga.insight.texto).toContain('14')
  })

  it('sin datos no revienta ni juzga', () => {
    const vacio = buildAcademicaResults({}, HOY)
    expect(vacio.titular).toEqual({ texto: 'No hubo sesiones por dictar en los últimos 30 días.', tono: null })
    expect(vacio.tarjetas).toHaveLength(4)
    expect(widget(vacio, '¿Se están registrando').grafico.categorias).toEqual([])
    expect(widget(vacio, '¿Se están registrando').insight).toBeNull()
    expect(widget(vacio, '¿Qué parte de lo dictado').pct).toBeNull()
  })
})
