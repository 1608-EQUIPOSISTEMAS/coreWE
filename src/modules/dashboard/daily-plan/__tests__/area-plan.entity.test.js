import { describe, it, expect } from 'vitest'
import {
  extractPendientes, enabledAreas, areaForRoles, areaFacts, buildAreaPayload, grupoDe, formatValue,
  AREA_PENDING_LIMIT
} from '../area-plan.entity.js'

// Panel de resultados de juguete con el contrato de results.entity.js.
const panel = (over = {}) => ({
  titular: { texto: '3 ventas esperan validación y 1 lleva más de 3 días.', tono: 'warn' },
  tarjetas: [
    { label: 'Bandeja por validar', valor: 3, unidad: 'num', tono: 'warn', comparativo: '1 con más de 3 días' },
    { label: 'Ingreso del mes', valor: 12500, unidad: 'soles', tono: 'ok', comparativo: null },
    { label: 'Morosidad 90 días', valor: null, unidad: 'pct', tono: null, comparativo: null }
  ],
  filas: [
    {
      disposicion: 'completa',
      widgets: [{
        tipo: 'tabla',
        titulo: 'Ventas que más esperan',
        columnas: [
          { key: 'alumno', label: 'Alumno', unidad: 'texto' },
          { key: 'programa', label: 'Programa', unidad: 'texto' },
          { key: 'dias', label: 'Días esperando', unidad: 'num' }
        ],
        filas: [
          { alumno: 'Ana Ruiz', programa: 'BI-01', dias: 5, tono_dias: 'bad', ruta: '/fico/inscripciones/9' },
          { alumno: 'Luis Paz', programa: 'SQL-02', dias: 1, tono_dias: null, ruta: '/fico/inscripciones/8' }
        ],
        verTodo: { ruta: '/fico/inscripciones' }
      }]
    },
    {
      disposicion: 'mitad',
      widgets: [
        {
          tipo: 'ranking',
          titulo: '¿Qué docentes deben registrar clases?',
          unidad: 'num',
          items: [
            { label: 'Prof. Soto', sublabel: '2 aulas', valor: 4, tono: 'warn', ruta: null },
            { label: 'Prof. Soto', sublabel: '2 aulas', valor: 4, tono: 'warn', ruta: null }
          ],
          verTodo: { ruta: '/academica/reporte' }
        },
        { tipo: 'ranking', titulo: 'Top 5 del equipo', unidad: 'num', items: [{ label: 'X', valor: 9, tono: null }] },
        { tipo: 'medidor', titulo: '¿Qué parte está al día?', pct: 60 }
      ]
    }
  ],
  ...over
})

describe('extractPendientes', () => {
  it('toma solo filas en rojo/ámbar de tablas y rankings, rojo primero', () => {
    const p = extractPendientes(panel())
    expect(p.map(x => x.titulo)).toEqual(['Ana Ruiz', 'Prof. Soto'])
    expect(p[0]).toMatchObject({ tono: 'bad', grupo: 'Ventas que más esperan', ruta: '/fico/inscripciones/9' })
    expect(p[0].detalle).toBe('BI-01 · Días esperando: 5')
  })

  it('sin ruta propia usa la de "ver todo" del widget, y quita duplicados', () => {
    const p = extractPendientes(panel())
    expect(p.filter(x => x.titulo === 'Prof. Soto')).toHaveLength(1)
    expect(p[1]).toMatchObject({ ruta: '/academica/reporte', grupo: 'Qué docentes deben registrar clases', detalle: '2 aulas · 4' })
  })

  it('respeta el tope y tolera un panel vacío o nulo', () => {
    const muchas = Array.from({ length: 20 }, (_, i) => ({ label: `E${i}`, valor: i, tono: 'bad' }))
    const p = extractPendientes({ filas: [{ widgets: [{ tipo: 'ranking', titulo: 'R', items: muchas }] }] })
    expect(p).toHaveLength(AREA_PENDING_LIMIT)
    expect(extractPendientes(null)).toEqual([])
  })
})

describe('enabledAreas', () => {
  it('por defecto Comercial, FICO, Académica y Producto', () => {
    expect(enabledAreas({})).toEqual(['COMERCIAL', 'FICO', 'ACADEMICA', 'PRODUCTO'])
  })

  it('lee AI_DAILY_PLAN_AREAS, ignora desconocidas y duplicados', () => {
    expect(enabledAreas({ AI_DAILY_PLAN_AREAS: 'fico, b2b,FICO,MARKETING' })).toEqual(['FICO', 'B2B'])
  })
})

describe('areaForRoles', () => {
  it('el rol de líder manda sobre el de colaborador', () => {
    expect(areaForRoles(['FICO', 'LIDER_ACADEMICA'])).toEqual({ area: 'ACADEMICA', rol: 'lider' })
    expect(areaForRoles(['PRODUCTO'])).toEqual({ area: 'PRODUCTO', rol: 'colaborador' })
  })

  it('solo entre las áreas encendidas', () => {
    expect(areaForRoles(['B2B'], ['FICO'])).toBeNull()
    expect(areaForRoles(['MARKETING'])).toBeNull()
  })
})

describe('areaFacts / buildAreaPayload', () => {
  it('los hechos traen veredicto, tarjetas con dato y pendientes numerados', () => {
    const r = panel()
    const facts = areaFacts('FICO', r, extractPendientes(r))
    expect(facts).toContain('Veredicto del día: 3 ventas esperan')
    expect(facts).toContain('Ingreso del mes: S/ 12,500.')
    expect(facts).not.toContain('Morosidad')
    expect(facts).toContain('1. [Ventas que más esperan] Ana Ruiz')
  })

  it('sin redacción del modelo cae al veredicto + el primer pendiente', () => {
    const r = panel()
    const p = buildAreaPayload({ area: 'FICO', results: r, resumenLider: null, enfoqueColaborador: 'Hoy valida a Ana.', pendientes: extractPendientes(r) })
    expect(p.resumen_lider).toContain('Lo primero hoy: Ana Ruiz')
    expect(p.enfoque_colaborador).toBe('Hoy valida a Ana.')
    expect(p.ia).toEqual({ resumen: false, enfoque: true })
    expect(p.tarjetas[1]).toEqual({ label: 'Ingreso del mes', valor: 'S/ 12,500', tono: 'ok', comparativo: null })
  })

  it('utilidades de formato', () => {
    expect(grupoDe('¿Qué aulas cerraron sin notas?')).toBe('Qué aulas cerraron sin notas')
    expect(formatValue(40, 'pct')).toBe('40%')
    expect(formatValue(3.5, 'horas')).toBe('3.5 h')
    expect(formatValue(null, 'num')).toBeNull()
  })
})
