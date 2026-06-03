import { pool } from '../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../shared/db/sp.js'

// Persistencia del dominio instructor. Envuelve los stored procedures
// sp_instructor_* y la actualizacion de IDs de Odoo.
export class InstructorRepository {
  constructor (db = pool, sp = callProcedureReturningRows) {
    this.db = db
    this.sp = sp
  }

  async register (instructor) {
    const rows = await this.sp(
      this.db,
      'public.sp_instructor_register',
      [JSON.stringify(instructor)],
      { statementTimeoutMs: 25000 }
    )
    return rows?.[0] ?? {}
  }

  async setOdoo (instructorId, odooUserId, odooPartnerId) {
    await this.db.query(
      'CALL public.sp_instructor_set_odoo($1, $2, $3)',
      [instructorId, odooUserId, odooPartnerId]
    )
  }

  async list ({ activeParam, cat_occupation, cat_person_status, q, page, size }) {
    return this.sp(
      this.db,
      'public.sp_instructor_list',
      [activeParam, cat_occupation, cat_person_status, q, page, size],
      { statementTimeoutMs: 25000 }
    )
  }

  async get (id) {
    const rows = await this.sp(
      this.db,
      'public.sp_instructor_get',
      [id],
      { statementTimeoutMs: 25000 }
    )
    return rows?.[0] || {}
  }

  async update (id, instructor) {
    const rows = await this.sp(
      this.db,
      'public.sp_instructor_update',
      [id, JSON.stringify(instructor || {})],
      { statementTimeoutMs: 25000 }
    )
    return rows?.[0] || {}
  }

  async caller ({ activeParam, cat_occupation, cat_person_status, q }) {
    return this.sp(
      this.db,
      'public.sp_instructor_caller',
      [activeParam, cat_occupation, cat_person_status, q],
      { statementTimeoutMs: 15000 }
    )
  }
}

export const instructorRepository = new InstructorRepository()
