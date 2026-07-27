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

  // Categorias de entrada de un evento (VIP/GENERAL/PREMIUM/VIRTUAL) con el
  // precio cargado para esa version de programa. LEFT JOIN a proposito: las 4
  // categorias siempre vuelven; sin fila de precio los montos llegan en 0 y el
  // formulario cae al precio del programa.
  // SQL directo (no SP) porque no depende de sp_catalog_list, que no expone
  // catalogos nuevos sin tocarlo.
  async eventCategoryList (programVersionId) {
    const { rows } = await this.db.query(`
      SELECT c.catalog_id AS cat_event_category,
             c.alias,
             c.description,
             COALESCE(p.price_student_soles,       0) AS price_student_soles,
             COALESCE(p.price_student_dollars,     0) AS price_student_dollars,
             COALESCE(p.price_profesional_soles,   0) AS price_profesional_soles,
             COALESCE(p.price_profesional_dollars, 0) AS price_profesional_dollars,
             (p.program_version_id IS NOT NULL)       AS has_price
        FROM public.catalog c
        JOIN public.catalog parent ON parent.catalog_id = c.catalog_parent_id
        LEFT JOIN public.event_category_prices p
               ON p.cat_event_category  = c.catalog_id
              AND p.program_version_id  = $1
              AND p.active              = 'Y'
       WHERE parent.alias = 'we_event_category'
         AND c.active = 'Y'
       ORDER BY c.description
    `, [programVersionId])
    return rows || []
  }
}

export const programRepository = new ProgramRepository()
