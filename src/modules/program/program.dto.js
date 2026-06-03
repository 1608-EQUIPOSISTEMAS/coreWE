// Forma de salida hacia el cliente. Mantiene paridad con el service legacy.
import { extractPaginationMeta } from './program.entity.js'

export const toRegisterDto = (row = {}) => ({
  program_id: row.program_id ?? null,
  program_versions: row.program_versions || []
})

export const toUpdateDto = (row = {}, id = null) => ({
  program_id: row.program_id ?? id ?? null,
  program_versions: row.program_versions || []
})

export const toPagedDto = ({ rows, page, size }) => ({
  ...extractPaginationMeta(rows, page, size),
  items: rows
})

export const toVersionCallerDto = (rows) => ({ items: rows })

export const toPriceListDto = (rows) => ({
  total: rows.length,
  items: rows
})

export const toPriceUpdateDto = (row = {}) => ({
  success: row.success ?? true
})
