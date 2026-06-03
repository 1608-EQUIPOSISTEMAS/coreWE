import { pool } from '../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../shared/db/sp.js'

// Persistencia del dominio program. Envuelve los stored procedures
// sp_program_* y sp_price_* preservando los timeouts por operacion.
export class ProgramRepository {
  constructor (db = pool, sp = callProcedureReturningRows) {
    this.db = db
    this.sp = sp
  }

  async register (programPayload) {
    return this.sp(
      this.db,
      'public.sp_program_register',
      [JSON.stringify(programPayload)],
      { statementTimeoutMs: 25000 }
    )
  }

  async list ({ activeParam, cat_type_program, cat_category, cat_model_modality, q, page, size }) {
    return this.sp(
      this.db,
      'public.sp_program_list',
      [
        activeParam,
        cat_type_program,
        cat_category,
        cat_model_modality,
        q,
        page,
        size
      ],
      { statementTimeoutMs: 25000 }
    )
  }

  async get (id) {
    return this.sp(
      this.db,
      'public.sp_program_get',
      [id],
      { statementTimeoutMs: 25000 }
    )
  }

  async update (id, programPayload) {
    return this.sp(
      this.db,
      'public.sp_program_update',
      [
        id,
        JSON.stringify(programPayload)
      ],
      { statementTimeoutMs: 25000 }
    )
  }

  async versionCaller ({ active, not_modality, cat_model_modality, cat_type_program, q }) {
    return this.sp(
      this.db,
      'public.sp_program_version_caller',
      [
        active,
        not_modality,
        cat_model_modality,
        cat_type_program,
        q
      ],
      { statementTimeoutMs: 25000 }
    )
  }

  async versionDetailGet (program_version_id) {
    return this.sp(
      this.db,
      'public.sp_program_version_detail_get',
      [program_version_id],
      { statementTimeoutMs: 25000 }
    )
  }

  async versionList ({ program_id, activeParam, q, cat_type_program, cat_category, cat_model_modality, program_version_id, page, size }) {
    return this.sp(
      this.db,
      'public.sp_program_version_list',
      [
        program_id,
        activeParam,
        q,
        cat_type_program,
        cat_category,
        cat_model_modality,
        program_version_id,
        page,
        size
      ],
      { statementTimeoutMs: 25000 }
    )
  }

  async priceList (charParam) {
    return this.sp(
      this.db,
      'public.sp_price_list',
      [charParam],
      { statementTimeoutMs: 25000 }
    )
  }

  async caller ({ q, cat_type_program, activeParam }) {
    return this.sp(
      this.db,
      'public.sp_program_caller',
      [
        q,
        cat_type_program,
        activeParam
      ],
      { statementTimeoutMs: 10000 }
    )
  }

  async priceUpdate ({ program_version_id, price_student_soles, price_student_dollars, price_professional_soles, price_professional_dollars, active, price_list_id, user_id }) {
    return this.sp(
      this.db,
      'public.sp_price_update',
      [
        program_version_id,
        price_student_soles,
        price_student_dollars,
        price_professional_soles,
        price_professional_dollars,
        active,
        price_list_id,
        user_id
      ],
      { statementTimeoutMs: 25000 }
    )
  }
}

export const programRepository = new ProgramRepository()
