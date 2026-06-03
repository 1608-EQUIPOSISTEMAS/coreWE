import { pool } from '../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../shared/db/sp.js'

// Persistencia del dominio corporate_agreement. Envuelve los stored procedures
// sp_b2b_agreement_* de los convenios B2B.
export class CorporateAgreementRepository {
  constructor (db = pool, sp = callProcedureReturningRows) {
    this.db = db
    this.sp = sp
  }

  async register (agreement) {
    return this.sp(
      this.db,
      'public.sp_b2b_agreement_register',
      [JSON.stringify(agreement || {})],
      { statementTimeoutMs: 25000 }
    )
  }

  async list ({ activeParam, q, page, size }) {
    return this.sp(
      this.db,
      'public.sp_b2b_agreement_list',
      [
        activeParam,
        q,
        page,
        size
      ],
      { statementTimeoutMs: 25000 }
    )
  }

  async caller ({ activeParam, q }) {
    return this.sp(
      this.db,
      'public.sp_b2b_agreement_caller',
      [
        activeParam,
        q
      ],
      { statementTimeoutMs: 15000 }
    )
  }

  async update (id, agreement) {
    return this.sp(
      this.db,
      'public.sp_b2b_agreement_update',
      [
        id,
        JSON.stringify(agreement || {})
      ],
      { statementTimeoutMs: 25000 }
    )
  }
}

export const corporateAgreementRepository = new CorporateAgreementRepository()
