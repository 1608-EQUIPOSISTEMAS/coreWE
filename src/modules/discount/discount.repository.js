import { pool } from '../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../shared/db/sp.js'

// Persistencia del dominio discount. Envuelve los stored procedures sp_discount_*.
export class DiscountRepository {
  constructor (db = pool, sp = callProcedureReturningRows) {
    this.db = db
    this.sp = sp
  }

  async register (discount) {
    const rows = await this.sp(
      this.db,
      'public.sp_discount_register',
      [JSON.stringify(discount || {})],
      { statementTimeoutMs: 25000 }
    )
    return rows?.[0] || {}
  }

  // sp_discount_list(p_active, p_cat_discount_type, p_is_global, p_q, p_page, p_size).
  // No recibe from_date, to_date ni campaign_id.
  async list ({ active, cat_discount_type, is_global, q, page, size }) {
    return this.sp(
      this.db,
      'public.sp_discount_list',
      [
        active,
        cat_discount_type,
        is_global,
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
      'public.sp_discount_get',
      [id],
      { statementTimeoutMs: 25000 }
    )
    return rows?.[0] || {}
  }

  async update (id, discount) {
    const rows = await this.sp(
      this.db,
      'public.sp_discount_update',
      [
        id,
        JSON.stringify(discount || {})
      ],
      { statementTimeoutMs: 25000 }
    )
    return rows?.[0] || {}
  }

  // sp_discount_caller(p_q, p_cat_discount_type, p_cat_currency, p_active).
  // p_cat_currency es INTEGER (catalog_id), NO el alias string. Pasar un alias
  // como 'we_currency_soles' rompe con "invalid input syntax for type integer".
  async caller ({ q, cat_discount_type, cat_currency, active }) {
    return this.sp(
      this.db,
      'public.sp_discount_caller',
      [
        q,
        cat_discount_type,
        cat_currency,
        active
      ],
      { statementTimeoutMs: 10000 }
    )
  }
}

export const discountRepository = new DiscountRepository()
