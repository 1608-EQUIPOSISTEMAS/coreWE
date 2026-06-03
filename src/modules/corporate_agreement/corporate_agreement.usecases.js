import { corporateAgreementRepository } from './corporate_agreement.repository.js'
import { normalizeActive, normalizeActiveForCaller } from './corporate_agreement.entity.js'
import { toRegisterDto, toUpdateDto, toListDto, toCallerDto } from './corporate_agreement.dto.js'

const repo = corporateAgreementRepository

export async function registerAgreement ({ agreement = {} } = {}) {
  const rows = await repo.register(agreement)
  return toRegisterDto({ row: rows?.[0] || {} })
}

export async function listAgreements (payload = {}) {
  const { active = null, q = null, page = 1, size = 25 } = payload
  const rows = await repo.list({
    activeParam: normalizeActive(active),
    q,
    page,
    size
  })
  return toListDto({ rows, page, size })
}

export async function callerAgreements (payload = {}) {
  const { active = 'Y', q = null } = payload
  const rows = await repo.caller({
    activeParam: normalizeActiveForCaller(active),
    q
  })
  return toCallerDto(rows)
}

export async function updateAgreement ({ id, agreement = {} }) {
  const rows = await repo.update(id, agreement)
  return toUpdateDto({ row: rows?.[0] || {}, id })
}
