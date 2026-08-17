import { pool } from '../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../shared/db/sp.js'

// Persistencia del dominio b2b. Envuelve los stored procedures de company,
// company lead y contract preservando los statement timeouts por SP.
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

  // Un cupo por alumno: el timeout va holgado porque cada uno resuelve persona,
  // cliente, contactos e inscripcion, y un contrato grande reparte decenas.
  async contractEnrollBeneficiaries (contractId, userId) {
    return this.sp(
      this.db,
      'public.sp_b2b_contract_enroll_beneficiaries',
      [contractId, userId],
      { statementTimeoutMs: 120000 }
    )
  }

