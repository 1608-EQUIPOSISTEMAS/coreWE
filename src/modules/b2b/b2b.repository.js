import { pool } from '../../shared/db/pool.js'
import { callProcedureReturningRows, callProcedureReturningResult } from '../../shared/db/sp.js'

// Persistencia del dominio b2b. Envuelve los stored procedures de company,
// company lead y contract preservando los statement timeouts por SP.
//
// Los SPs de este dominio vienen en dos formas y NO son intercambiables:
//   · consulta  -> ultimo parametro `INOUT p_result refcursor`  -> this.sp
//   · mutacion  -> `OUT result, OUT message[, OUT <x>_id]`       -> this.spResult
// Mandar una mutacion por this.sp le agrega un cursor que el SP no declara y
// Postgres responde "no existe el procedimiento (unknown, unknown)".
export class B2bRepository {
  constructor (db = pool, sp = callProcedureReturningRows, spResult = callProcedureReturningResult) {
    this.db = db
    this.sp = sp
    this.spResult = spResult
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

  async companyGet (companyId) {
    return this.sp(
      this.db,
      'public.sp_b2b_company_get',
      [companyId],
      { statementTimeoutMs: 10000 }
    )
  }

  async companyRegister (payload) {
    return this.spResult(
      this.db,
      'public.sp_b2b_company_register',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 25000, outputs: 3 }
    )
  }

  async companyUpdate (companyId, payload) {
    return this.spResult(
      this.db,
      'public.sp_b2b_company_update',
      [companyId, JSON.stringify(payload)],
      { statementTimeoutMs: 25000, outputs: 2 }
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

  async contractGet (contractId) {
    return this.sp(
      this.db,
      'public.sp_b2b_contract_get',
      [contractId],
      { statementTimeoutMs: 10000 }
    )
  }

  async contractRegister (payload) {
    return this.spResult(
      this.db,
      'public.sp_b2b_contract_register',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 25000, outputs: 3 }
    )
  }

  async contractUpdate (contractId, payload) {
    return this.spResult(
      this.db,
      'public.sp_b2b_contract_update',
      [contractId, JSON.stringify(payload)],
      { statementTimeoutMs: 25000, outputs: 2 }
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

}

export const b2bRepository = new B2bRepository()
