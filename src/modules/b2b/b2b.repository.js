import { pool } from '../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../shared/db/sp.js'

// Persistencia del dominio b2b. Envuelve los stored procedures de company,
// company lead, contract y agreement preservando los statement timeouts por SP.
export class B2bRepository {
  constructor (db = pool, sp = callProcedureReturningRows) {
    this.db = db
    this.sp = sp
  }

  // ── COMPANY ──────────────────────────────────────────────────

  async companyCaller (payload) {
    return this.sp(
      this.db,
      'public.sp_b2b_company_caller',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 10000 }
    )
  }

  async companyList (payload) {
    return this.sp(
      this.db,
      'public.sp_b2b_company_list',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 25000 }
    )
  }

  async companyGet (payload) {
    return this.sp(
      this.db,
      'public.sp_b2b_company_get',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 10000 }
    )
  }

  async companyRegister (payload) {
    return this.sp(
      this.db,
      'public.sp_b2b_company_register',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 25000 }
    )
  }

  async companyUpdate (payload) {
    return this.sp(
      this.db,
      'public.sp_b2b_company_update',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 25000 }
    )
  }

  // ── LEAD EMPRESA ─────────────────────────────────────────────

  async companyLeadList (payload) {
    return this.sp(
      this.db,
      'public.sp_company_lead_list',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 25000 }
    )
  }

  async companyLeadGet (leadId) {
    return this.sp(
      this.db,
      'public.sp_company_lead_get',
      [leadId],
      { statementTimeoutMs: 10000 }
    )
  }

  async companyLeadRegister (lead, contactAttempts, userRegistrationId) {
    return this.sp(
      this.db,
      'public.sp_company_lead_register',
      [
        JSON.stringify(lead),
        JSON.stringify(contactAttempts),
        userRegistrationId
      ],
      { statementTimeoutMs: 25000 }
    )
  }

  // ── CONTRACT ─────────────────────────────────────────────────

  async contractList (payload) {
    return this.sp(
      this.db,
      'public.sp_b2b_contract_list',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 25000 }
    )
  }

  async contractGet (payload) {
    return this.sp(
      this.db,
      'public.sp_b2b_contract_get',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 10000 }
    )
  }

  async contractRegister (payload) {
    return this.sp(
      this.db,
      'public.sp_b2b_contract_register',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 25000 }
    )
  }

  async contractUpdate (payload) {
    return this.sp(
      this.db,
      'public.sp_b2b_contract_update',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 25000 }
    )
  }

  // ── AGREEMENT ────────────────────────────────────────────────

  async agreementList (payload) {
    return this.sp(
      this.db,
      'public.sp_b2b_agreement_list',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 25000 }
    )
  }

  async agreementGet (payload) {
    return this.sp(
      this.db,
      'public.sp_b2b_agreement_get',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 10000 }
    )
  }

  async agreementRegister (agreement, discounts) {
    return this.sp(
      this.db,
      'public.sp_b2b_agreement_register',
      [
        JSON.stringify(agreement),
        JSON.stringify(discounts)
      ],
      { statementTimeoutMs: 25000 }
    )
  }

  async agreementUpdate (agreement, discounts) {
    return this.sp(
      this.db,
      'public.sp_b2b_agreement_update',
      [
        JSON.stringify(agreement),
        JSON.stringify(discounts)
      ],
      { statementTimeoutMs: 25000 }
    )
  }
}

export const b2bRepository = new B2bRepository()
