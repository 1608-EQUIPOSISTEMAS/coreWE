import { b2bRepository } from './b2b.repository.js'
import {
  normalizeCompanyLeadPayload, normalizeId, splitUpdatePayload, summarizeEnrollment
} from './b2b.entity.js'
import { toCallerData, toListData, toGetData, toMutationResult } from './b2b.dto.js'

const repo = b2bRepository

// ── COMPANY ──────────────────────────────────────────────────

export async function companyCaller (payload = {}) {
  return toCallerData(await repo.companyCaller(payload))
}

export async function companyList (payload = {}) {
  return toListData(await repo.companyList(payload), payload)
}

export async function companyGet (payload = {}) {
  return toGetData(await repo.companyGet(normalizeId(payload.id ?? payload.company_id)))
}

export async function companyRegister (payload = {}) {
  return toMutationResult(await repo.companyRegister(payload))
}

export async function companyUpdate (payload = {}) {
  const { id, data } = splitUpdatePayload(payload)
  if (!id) return { result: 0, message: 'Falta la empresa a actualizar' }
  return toMutationResult(await repo.companyUpdate(id, data))
}

// ── LEAD EMPRESA ─────────────────────────────────────────────

export async function companyLeadList (payload = {}) {
  return toListData(await repo.companyLeadList(payload), payload)
}

export async function companyLeadGet (payload = {}) {
  const leadId = normalizeId(payload.lead_id)
  return toGetData(await repo.companyLeadGet(leadId))
}

export async function companyLeadRegister (payload = {}) {
  const { lead, contactAttempts, userRegistrationId } = normalizeCompanyLeadPayload(payload)
  return toMutationResult(await repo.companyLeadRegister(lead, contactAttempts, userRegistrationId))
}

// ── CONTRACT ─────────────────────────────────────────────────

export async function contractList (payload = {}) {
  return toListData(await repo.contractList(payload), payload)
}

export async function contractGet (payload = {}) {
  return toGetData(await repo.contractGet(normalizeId(payload.id ?? payload.contract_id)))
}

export async function contractRegister (payload = {}) {
  return toMutationResult(await repo.contractRegister(payload))
}

export async function contractUpdate (payload = {}) {
  const { id, data } = splitUpdatePayload(payload)
  if (!id) return { result: 0, message: 'Falta el contrato a actualizar' }
  return toMutationResult(await repo.contractUpdate(id, data))
}

// Manda a FICO los cupos del contrato que todavia no son inscripcion.
export async function contractEnrollBeneficiaries (payload = {}) {
  const contractId = normalizeId(payload.contract_id)
  if (!contractId) return { result: 0, message: 'Falta el contrato' }
  const rows = await repo.contractEnrollBeneficiaries(contractId, normalizeId(payload.user_id))
  const resumen = summarizeEnrollment(rows)
  return { result: 1, message: `${resumen.enrolled} inscripcion(es) creada(s)`, ...resumen }
}

