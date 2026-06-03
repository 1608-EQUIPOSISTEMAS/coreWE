// Forma de salida hacia el cliente. Mantiene paridad con el service legacy.
import { buildListItem, buildGetResult, buildCallerItem, paginationDefaults } from './discount.entity.js'

export const toRegisterDto = ({ row }) => ({
  discount_id: row.discount_id ?? null
})

export const toListDto = ({ rows, page, size }) => {
  const { page: safePage, size: safeSize } = paginationDefaults({ page, size })
  return {
    total: rows?.[0]?.total_count ? Number(rows[0].total_count) : 0,
    page: safePage,
    size: safeSize,
    items: rows.map(buildListItem)
  }
}

export const toGetDto = ({ row }) => ({
  data: buildGetResult(row)
})

export const toUpdateDto = ({ row, id }) => ({
  discount_id: row.discount_id ?? id ?? null
})

export const toCallerDto = ({ rows }) => rows.map(buildCallerItem)
