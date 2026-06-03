import { discountRepository } from './discount.repository.js'
import { paginationDefaults } from './discount.entity.js'
import { toRegisterDto, toListDto, toGetDto, toUpdateDto, toCallerDto } from './discount.dto.js'

const repo = discountRepository

export async function registerDiscount ({ discount = {} } = {}) {
  const row = await repo.register(discount)
  return toRegisterDto({ row })
}

export async function listDiscounts (payload = {}) {
  const {
    active = null,
    cat_discount_type = null,
    is_global = null,
    q = null,
    page = 1,
    size = 25
  } = payload

  const { page: safePage, size: safeSize } = paginationDefaults({ page, size })
  const rows = await repo.list({
    active,
    cat_discount_type,
    is_global,
    q,
    page: safePage,
    size: safeSize
  })
  return toListDto({ rows, page: safePage, size: safeSize })
}

export async function getDiscount ({ id }) {
  const row = await repo.get(id)
  return toGetDto({ row })
}

export async function updateDiscount ({ id, discount = {} }) {
  const row = await repo.update(id, discount)
  return toUpdateDto({ row, id })
}

export async function callerDiscounts (payload = {}) {
  const {
    q = null,
    cat_discount_type = null,
    cat_currency = null,
    active = true
  } = payload

  const rows = await repo.caller({ q, cat_discount_type, cat_currency, active })
  return toCallerDto({ rows })
}
