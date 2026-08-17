import { b2bRepository } from './b2b.repository.js'
import { normalizeCompanyLeadPayload, normalizeLeadId, summarizeEnrollment } from './b2b.entity.js'
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

// Manda a FICO los cupos del contrato que todavia no son inscripcion.
export async function contractEnrollBeneficiaries (payload = {}) {
  const contractId = normalizeLeadId(payload.contract_id)
  if (!contractId) return { result: 0, message: 'Falta el contrato' }
  const rows = await repo.contractEnrollBeneficiaries(contractId, normalizeLeadId(payload.user_id))
  const resumen = summarizeEnrollment(rows)
  return { result: 1, message: `${resumen.enrolled} inscripcion(es) creada(s)`, ...resumen }
}

