import { b2bRepository } from './b2b.repository.js'
import { normalizeCompanyLeadPayload, normalizeLeadId, normalizeDiscounts } from './b2b.entity.js'
import { toListData, toGetData, toMutationResult } from './b2b.dto.js'

const repo = b2bRepository

// ── COMPANY ──────────────────────────────────────────────────

export async function companyCaller (payload = {}) {
  return toListData(await repo.companyCaller(payload))
}

export async function companyList (payload = {}) {
  return toListData(await repo.companyList(payload))
}

export async function companyGet (payload = {}) {
  return toGetData(await repo.companyGet(payload))
}

export async function companyRegister (payload = {}) {
  return toMutationResult(await repo.companyRegister(payload))
}

export async function companyUpdate (payload = {}) {
  return toMutationResult(await repo.companyUpdate(payload))
}

// ── LEAD EMPRESA ─────────────────────────────────────────────

export async function companyLeadList (payload = {}) {
  return toListData(await repo.companyLeadList(payload))
}

export async function companyLeadGet (payload = {}) {
  const leadId = normalizeLeadId(payload.lead_id)
  return toGetData(await repo.companyLeadGet(leadId))
}

export async function companyLeadRegister (payload = {}) {
  const { lead, contactAttempts, userRegistrationId } = normalizeCompanyLeadPayload(payload)
  return toMutationResult(await repo.companyLeadRegister(lead, contactAttempts, userRegistrationId))
}

// ── CONTRACT ─────────────────────────────────────────────────

export async function contractList (payload = {}) {
  return toListData(await repo.contractList(payload))
}

export async function contractGet (payload = {}) {
  return toGetData(await repo.contractGet(payload))
}

export async function contractRegister (payload = {}) {
  return toMutationResult(await repo.contractRegister(payload))
}

export async function contractUpdate (payload = {}) {
  return toMutationResult(await repo.contractUpdate(payload))
}

// ── AGREEMENT ────────────────────────────────────────────────

export async function agreementList (payload = {}) {
  return toListData(await repo.agreementList(payload))
}

export async function agreementGet (payload = {}) {
  return toGetData(await repo.agreementGet(payload))
}

export async function agreementRegister ({ agreement = {}, discounts = [] } = {}) {
  return toMutationResult(await repo.agreementRegister(agreement, normalizeDiscounts(discounts)))
}

export async function agreementUpdate ({ agreement = {}, discounts = [] } = {}) {
  return toMutationResult(await repo.agreementUpdate(agreement, normalizeDiscounts(discounts)))
}
