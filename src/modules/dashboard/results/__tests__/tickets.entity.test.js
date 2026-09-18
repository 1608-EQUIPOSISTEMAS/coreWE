import { describe, it, expect } from 'vitest'
import {
  buildTicketRows, evaluarAbiertos, statusDonut, openTicketsTable, slaGauge, timeMetrics, responseTrend
} from '../tickets.entity.js'

const AHORA = new Date('2026-03-15T12:00:00Z')
const hace = horas => new Date(AHORA.getTime() - horas * 3600_000)
const dentro = horas => new Date(AHORA.getTime() + horas * 3600_000)

const abierto = (o = {}) => ({
  ticket_id: 1,
  title: 'No abre el ERP',
  priority: 'MEDIA',
  status: 'ABIERTO',
  registration_date: hace(10),
  first_response_due_at: dentro(5),
  first_response_at: null,
  resolution_due_at: dentro(20),
  resolved_at: null,
  dias: 0,
  ...o
})

describe('evaluarAbiertos', () => {
  it('marca vencido cuando cualquiera de los dos relojes paso', () => {
    const [t] = evaluarAbiertos([abierto({ first_response_due_at: hace(1) })], AHORA)
    expect(t.vencido).toBe(true)
  })

  it('marca por vencer al cruzar el umbral, sin estar vencido', () => {
    // 9 de 10 horas consumidas del plazo de primera respuesta: 90%.
    const [t] = evaluarAbiertos([abierto({ registration_date: hace(9), first_response_due_at: dentro(1) })], AHORA)
    expect(t.porVencer).toBe(true)
    expect(t.vencido).toBe(false)
  })

  it('con margen no marca nada', () => {
    const [t] = evaluarAbiertos([abierto({ registration_date: hace(1), first_response_due_at: dentro(50) })], AHORA)
    expect(t).toMatchObject({ vencido: false, porVencer: false })
  })
})

describe('statusDonut', () => {
  it('sin tickets no dibuja la dona', () => {
    expect(statusDonut({ total: 0 })).toBeNull()
  })

  it('reparte los tres estados y suma el total', () => {
    const w = statusDonut({ abiertos: 2, en_progreso: 1, cerrados: 7, total: 10, vencidos: 0 })
    expect(w.tipo).toBe('dona')
    expect(w.total).toBe(10)
    expect(w.segmentos.map(s => s.valor)).toEqual([7, 1, 2])
  })

  it('todo cerrado se dice con todas las letras', () => {
    const w = statusDonut({ abiertos: 0, en_progreso: 0, cerrados: 5, total: 5, vencidos: 0 })
    expect(w.insight.texto).toMatch(/ya está cerrado/)
    expect(w.insight.tono).toBe('ok')
  })

  it('el tono lo decide lo vencido, no lo pendiente', () => {
    const muchosAbiertos = statusDonut({ abiertos: 8, en_progreso: 0, cerrados: 2, total: 10, vencidos: 0 })
    const pocoVencido = statusDonut({ abiertos: 1, en_progreso: 0, cerrados: 9, total: 10, vencidos: 3 })
    expect(muchosAbiertos.insight.tono).toBe('ok')
    expect(pocoVencido.insight.tono).toBe('bad')
  })

  it('singular y plural del pendiente', () => {
    expect(statusDonut({ abiertos: 1, en_progreso: 0, cerrados: 0, total: 1, vencidos: 0 }).insight.texto)
      .toMatch(/1 sigue sin cerrarse/)
    expect(statusDonut({ abiertos: 2, en_progreso: 0, cerrados: 0, total: 2, vencidos: 0 }).insight.texto)
      .toMatch(/2 siguen sin cerrarse/)
  })
})

describe('openTicketsTable', () => {
  it('sin abiertos no dibuja la tabla', () => {
    expect(openTicketsTable([])).toBeNull()
  })

  it('ordena vencidos primero, luego por vencer, luego los mas viejos', () => {
    const filas = openTicketsTable([
      { ...abierto({ ticket_id: 1, dias: 1 }), vencido: false, porVencer: false },
      { ...abierto({ ticket_id: 2, dias: 2 }), vencido: false, porVencer: true },
      { ...abierto({ ticket_id: 3, dias: 3 }), vencido: true, porVencer: false },
      { ...abierto({ ticket_id: 4, dias: 9 }), vencido: false, porVencer: false }
    ]).filas
    expect(filas.map(f => f.codigo)).toEqual(['#00003', '#00002', '#00004', '#00001'])
  })

  it('respeta el limite de 10 y lo dice en el insight', () => {
    const muchos = Array.from({ length: 14 }, (_, i) =>
      ({ ...abierto({ ticket_id: i + 1 }), vencido: false, porVencer: false }))
    const w = openTicketsTable(muchos)
    expect(w.filas).toHaveLength(10)
    expect(w.insight.texto).toMatch(/14 tickets abiertos/)
  })

  it('sin exceso no inventa insight', () => {
    expect(openTicketsTable([{ ...abierto(), vencido: false, porVencer: false }]).insight).toBeNull()
  })

  it('el tono del SLA acompana al veredicto', () => {
    const [fila] = openTicketsTable([{ ...abierto(), vencido: true, porVencer: false }]).filas
    expect(fila.sla).toBe('Vencido')
    expect(fila.tono_sla).toBe('bad')
  })

  it('todas las columnas de texto declaran su unidad', () => {
    const w = openTicketsTable([{ ...abierto(), vencido: false, porVencer: false }])
    // Sin unidad, ResultWidget alinearia el asunto a la derecha.
    expect(w.columnas.every(c => c.unidad)).toBe(true)
  })
})

describe('slaGauge', () => {
  it('sin veredictos no dibuja el medidor', () => {
    expect(slaGauge({ resp_a_tiempo: 0, resp_tarde: 0, res_a_tiempo: 0, res_tarde: 0 })).toBeNull()
  })

  it('el porcentaje mezcla los dos relojes', () => {
    const w = slaGauge({ resp_a_tiempo: 8, resp_tarde: 2, res_a_tiempo: 7, res_tarde: 3 })
    expect(w.pct).toBe(75)
  })

  it('la meta es el 100%: cumplir de sobra no existe', () => {
    expect(slaGauge({ resp_a_tiempo: 10, resp_tarde: 0, res_a_tiempo: 10, res_tarde: 0 }).tono).toBe('ok')
    expect(slaGauge({ resp_a_tiempo: 9, resp_tarde: 1, res_a_tiempo: 9, res_tarde: 1 }).tono).toBe('warn')
    expect(slaGauge({ resp_a_tiempo: 5, resp_tarde: 5, res_a_tiempo: 5, res_tarde: 5 }).tono).toBe('bad')
  })
})

describe('timeMetrics', () => {
  it('sin nada que contar no dibuja el widget', () => {
    expect(timeMetrics({})).toBeNull()
  })

  it('una mediana nula viaja como null, no como cero', () => {
    const w = timeMetrics({ mediana_resp_horas: null, mediana_res_horas: null, escalados: 2, sin_tomar: 0 })
    expect(w.items[0].valor).toBeNull()
    expect(w.items[1].valor).toBeNull()
  })

  it('escalados y sin tomar se marcan en ambar solo si los hay', () => {
    const conProblemas = timeMetrics({ mediana_resp_horas: 3, escalados: 1, sin_tomar: 2 })
    const limpio = timeMetrics({ mediana_resp_horas: 3, escalados: 0, sin_tomar: 0 })
    expect(conProblemas.items[2].tono).toBe('warn')
    expect(conProblemas.items[3].tono).toBe('warn')
    expect(limpio.items[2].tono).toBeNull()
    expect(limpio.items[3].tono).toBeNull()
  })
})

describe('responseTrend', () => {
  it('sin historico no dibuja el grafico', () => {
    expect(responseTrend([], AHORA)).toBeNull()
  })

  it('ordena del mes mas viejo al actual y rotula el ultimo "(al dia)"', () => {
    const w = responseTrend([
      { meses_atras: 0, mediana_res_horas: 2, tickets: 3 },
      { meses_atras: 2, mediana_res_horas: 6, tickets: 5 },
      { meses_atras: 1, mediana_res_horas: 4, tickets: 4 }
    ], AHORA)
    expect(w.grafico.tipo).toBe('linea')
    expect(w.grafico.series[0].datos).toEqual([6, 4, 2])
    expect(w.grafico.categorias.at(-1)).toMatch(/al día/)
  })

  it('la referencia es la mediana de los meses cerrados, sin el actual', () => {
    const w = responseTrend([
      { meses_atras: 0, mediana_res_horas: 100 },
      { meses_atras: 1, mediana_res_horas: 4 },
      { meses_atras: 2, mediana_res_horas: 6 }
    ], AHORA)
    expect(w.grafico.referencia.valor).toBe(5)
  })

  it('con un solo mes no hay referencia contra la cual comparar', () => {
    expect(responseTrend([{ meses_atras: 0, mediana_res_horas: 3 }], AHORA).grafico.referencia).toBeNull()
  })
})

describe('buildTicketRows', () => {
  it('un area sin tickets no agrega filas vacias al panel', () => {
    expect(buildTicketRows({ estado: { total: 0 }, abiertos: [], tiempos: {}, tendencia: [] }, AHORA))
      .toEqual([])
  })

  it('con datos arma las dos filas del panel', () => {
    const filas = buildTicketRows({
      estado: { abiertos: 1, en_progreso: 1, cerrados: 3, total: 5, vencidos: 1 },
      abiertos: [abierto()],
      tiempos: { resp_a_tiempo: 4, resp_tarde: 1, res_a_tiempo: 3, res_tarde: 0, mediana_resp_horas: 2, escalados: 0, sin_tomar: 1 },
      tendencia: [{ meses_atras: 0, mediana_resp_horas: 2 }, { meses_atras: 1, mediana_resp_horas: 3 }]
    }, AHORA)

    expect(filas).toHaveLength(2)
    expect(filas[0].widgets.map(w => w.tipo)).toEqual(['dona', 'tabla'])
    expect(filas[1].widgets.map(w => w.tipo)).toEqual(['medidor', 'metricas', 'grafico'])
  })

  it('una fila incompleta se reacomoda sola', () => {
    const filas = buildTicketRows({
      estado: { total: 0 },
      abiertos: [abierto()],
      tiempos: {},
      tendencia: []
    }, AHORA)
    // Sin dona queda un solo widget: la fila pasa de 'mitad' a 'completa'.
    expect(filas[0]).toMatchObject({ disposicion: 'completa' })
    expect(filas[0].widgets).toHaveLength(1)
  })
})
