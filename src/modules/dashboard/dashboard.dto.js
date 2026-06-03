// Forma de salida hacia el cliente. Mantiene paridad con el service legacy.
import {
  mapDashboardRow,
  mapProgramGoalRow,
  mapLiderRow,
  mapContactabilityRow,
  formatWeekLabel
} from './dashboard.entity.js'

export const toDashboardDto = (rows) => {
  const items = rows.map(mapDashboardRow)
  return { total: items.length, items }
}

export const toProgramGoalsDto = (rows) => {
  const items = rows.map(mapProgramGoalRow)
  return { total: items.length, items }
}

export const toLiderDto = (rows) => {
  const items = rows.map(mapLiderRow)
  return { total: items.length, items }
}

export const toContactabilityDto = (rows) => {
  const items = rows.map(mapContactabilityRow)
  return { total: items.length, items }
}

export const toAvailableWeeksDto = (rows) => rows.map((r, idx) => formatWeekLabel(r, idx))

// Los detalles devuelven filas crudas de las vistas (SELECT *), igual que el legacy.
export const toDetailLeadsDto = (rows) => rows
export const toDetailSalesDto = (rows) => rows
