import { pool } from '../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../shared/db/sp.js'

// Persistencia y accesos IO del dominio customer. Envuelve los stored procedures
// sp_customer_* / sp_comercial_customer_info_get y la consulta externa a SUNAT.
export class CustomerRepository {
  constructor (db = pool, sp = callProcedureReturningRows, { sunatToken = process.env.SUNAT_API_TOKEN, fetchFn = fetch } = {}) {
    this.db = db
    this.sp = sp
    this.sunatToken = sunatToken
    this.fetchFn = fetchFn
  }

  async register (payload) {
    const rows = await this.sp(
      this.db,
      'public.sp_customer_register',
      [ JSON.stringify(payload) ],
      { statementTimeoutMs: 25000 }
    )
    return rows?.[0] || {}
  }

  async list ({ active, cat_customer_segment, cat_customer_status, q, page, size }) {
    return this.sp(
      this.db,
      'public.sp_customer_list',
      [
        active,
        cat_customer_segment,
        cat_customer_status,
        q,
        page,
        size
      ],
      { statementTimeoutMs: 25000 }
    )
  }

  async get (id) {
    const rows = await this.sp(
      this.db,
      'public.sp_customer_get',
      [ id ],
      { statementTimeoutMs: 25000 }
    )
    return rows?.[0] || {}
  }

  async update (id, payload) {
    const rows = await this.sp(
      this.db,
      'public.sp_customer_update',
      [
        id,
        JSON.stringify(payload)
      ],
      { statementTimeoutMs: 25000 }
    )
    return rows?.[0] || {}
  }

  async caller ({ active, q }) {
    return this.sp(
      this.db,
      'public.sp_customer_caller',
      [
        active,
        q
      ],
      { statementTimeoutMs: 10000 }
    )
  }

  async infoGet (document) {
    const rows = await this.sp(
      this.db,
      'public.sp_comercial_customer_info_get',
      [ document ],
      { statementTimeoutMs: 15000 }
    )
    return rows?.[0] || {}
  }

  // Consulta el documento contra la API externa de ruc.com.pe.
  // Devuelve la respuesta cruda; el mapeo se resuelve en la capa de dominio.
  async lookupSunat ({ document, isRuc }) {
    const payload = {
      token: this.sunatToken,
      ...(isRuc ? { ruc: document } : { dni: document })
    }
    const response = await this.fetchFn('https://ruc.com.pe/api/v1/consultas', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    })
    return response.json()
  }

  hasSunatToken () {
    return Boolean(this.sunatToken)
  }
}

export const customerRepository = new CustomerRepository()
