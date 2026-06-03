import { catalogRepository } from './catalog.repository.js'
import { buildMembershipParams } from './catalog.entity.js'
import { toCatalogDto, toMembershipListDto } from './catalog.dto.js'

const repo = catalogRepository

export async function getCatalog () {
  const rows = await repo.catalogList()
  return toCatalogDto(rows)
}

export async function getMembershipList ({ active, q, page, size } = {}) {
  const params = buildMembershipParams({ active, q, page, size })
  const rows = await repo.membershipList(params)
  return toMembershipListDto(rows)
}
