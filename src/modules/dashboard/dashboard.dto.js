// Forma de salida hacia el cliente. Mantiene paridad con el service legacy.
import {
  mapDashboardRow,
  mapProgramGoalRow,
  mapGerenciaFunnelRow
} from './dashboard.entity.js'

export const toDashboardDto = (rows) => {
  const items = rows.map(mapDashboardRow)
  return { total: items.length, items }
}

export const toProgramGoalsDto = (rows) => {
  const items = rows.map(mapProgramGoalRow)
  return { total: items.length, items }
}

// Una linea del historial del objetivo, tal como la dejo el trigger. Un ALTA no
// tiene "antes": esos campos van en null a proposito, no por falta de dato, y la
// pantalla muestra solo el valor nuevo en vez de un "0 -> 12" que mentiria.
export const toGoalHistoryDto = (r) => ({
  fecha: r.fecha,
  edition_id: r.edition_num_id,
  programa: r.programa,
  codigo: r.codigo,
  inicio: r.fecha_inicio,
  ventas_antes: r.ventas_antes === null ? null : Number(r.ventas_antes),
  ventas_despues: r.ventas_despues === null ? null : Number(r.ventas_despues),
  consultas_antes: r.consultas_antes === null ? null : Number(r.consultas_antes),
  consultas_despues: r.consultas_despues === null ? null : Number(r.consultas_despues),
  origen: r.origen,
  autor: r.autor
})

// Reporte de Gerencia: filas por edicion + la matriz de canales del mes ya
// agregada. Se suma aca y no en el front porque los tres niveles del reporte
// (cabecera, matriz, tabla) leen exactamente los mismos numeros.
export const toGerenciaFunnelDto = (rows) => {
  const items = rows.map(mapGerenciaFunnelRow)

  const porCanal = new Map()
  for (const it of items) {
    for (const c of it.canales) {
      const acc = porCanal.get(c.key) || { key: c.key, grupo: c.grupo, momento: c.momento, consultas: 0, ventas: 0, meta_consultas: 0, meta_ventas: 0 }
      acc.consultas += c.consultas
      acc.ventas += c.ventas
      acc.meta_consultas += c.meta_consultas
      acc.meta_ventas += c.meta_ventas
      porCanal.set(c.key, acc)
    }
  }

  const sum = (f) => items.reduce((s, i) => s + f(i), 0)
  const consultas = sum(i => i.consultas)
  const ventas = sum(i => i.ventas)

  return {
    total: items.length,
    items,
    canales: [...porCanal.values()].map(c => ({
      ...c,
      conversion_pct: c.consultas > 0 ? Math.round((c.ventas / c.consultas) * 1000) / 10 : null
    })),
    totales: {
      ediciones: items.length,
      consultas,
      ventas,
      venta_monto: sum(i => i.venta_monto),
      ventas_trazadas: sum(i => i.ventas_trazadas),
      meta_consultas: sum(i => i.meta_consultas),
      meta_ventas: sum(i => i.meta_ventas),
      meta_monto: sum(i => i.meta_monto),
      conversion_pct: consultas > 0 ? Math.round((ventas / consultas) * 1000) / 10 : null
    }
  }
}

// Los detalles devuelven filas crudas de las vistas (SELECT *), igual que el legacy.
export const toDetailLeadsDto = (rows) => rows
export const toDetailSalesDto = (rows) => rows
