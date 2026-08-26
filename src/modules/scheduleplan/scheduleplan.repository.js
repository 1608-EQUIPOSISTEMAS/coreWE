import { pool } from '../../shared/db/pool.js'
import { editionRepository } from '../edition/edition.repository.js'

// Persistencia del modulo Planificacion.
//
// SQL directo y no stored procedures: schedule_plans es una tabla de borradores
// con un JSONB adentro, no tiene reglas de negocio que defender en la BD y un SP
// por cada CRUD seria ceremonia sin beneficio.
//
// Lo que si delega en editionRepository son las lecturas y escrituras del
// cronograma real (copiar el anio anterior, publicar). Ese modulo ya envuelve
// los SPs correctos y duplicar esas llamadas seria una segunda verdad.
export class SchedulePlanRepository {
  constructor (db = pool, editions = editionRepository) {
    this.db = db
    this.editions = editions
  }

  async list (year = null) {
    const { rows } = await this.db.query(`
      SELECT plan_id, name, year,
             jsonb_array_length(items) AS item_count,
             (SELECT COUNT(*) FROM jsonb_array_elements(items) i
               WHERE i->>'published_edition_id' IS NOT NULL) AS published_count,
             registration_date, modification_date
        FROM schedule_plans
       WHERE active = 'Y'
         AND ($1::int IS NULL OR year = $1::int)
       ORDER BY year DESC, plan_id DESC`, [year])
    return rows
  }

  async get (planId) {
    const { rows } = await this.db.query(
      `SELECT plan_id, name, year, items, registration_date, modification_date
         FROM schedule_plans WHERE plan_id = $1 AND active = 'Y'`, [planId])
    return rows[0] || null
  }

  async insert ({ name, year, items = [], userId = null }) {
    const { rows } = await this.db.query(`
      INSERT INTO schedule_plans (name, year, items, user_registration_id)
      VALUES ($1, $2, $3::jsonb, $4)
      RETURNING plan_id, name, year, items`,
    [name, year, JSON.stringify(items), userId])
    return rows[0]
  }

  async saveItems ({ planId, name, items, userId = null }) {
    const { rows } = await this.db.query(`
      UPDATE schedule_plans
         SET items = $2::jsonb,
             name = COALESCE($3, name),
             user_modification_id = $4,
             modification_date = NOW()
       WHERE plan_id = $1 AND active = 'Y'
      RETURNING plan_id, name, year, items`,
    [planId, JSON.stringify(items), name ?? null, userId])
    return rows[0] || null
  }

  async softDelete ({ planId, userId = null }) {
    const { rowCount } = await this.db.query(`
      UPDATE schedule_plans
         SET active = 'N', user_modification_id = $2, modification_date = NOW()
       WHERE plan_id = $1 AND active = 'Y'`, [planId, userId])
    return rowCount > 0
  }

  // ── Cronograma real ─────────────────────────────────────────────────────

  monthEditions ({ month, year }) {
    return this.editions.listByWeek({ selectedMonth: month, selectedYear: year, page: 1, size: 500 })
  }

  editionTree (editionId) {
    return this.editions.treeGet(editionId)
  }

  // Los ids que sp_edition_by_week_list no expone (segmento, dias, horas,
  // vacantes) y que el payload de registro si necesita. Una sola consulta para
  // todo el mes: la alternativa era un sp_edition_tree_get por edicion.
  // Devuelve un mapa por edition_num_id para que el llamador no arme el indice.
  async rawEditionColumns (editionIds = []) {
    const ids = editionIds.map(Number).filter(Boolean)
    if (!ids.length) return {}
    const { rows } = await this.db.query(`
      SELECT edition_num_id,
             cat_segment AS cat_segment_id,
             cat_day_combination_id,
             cat_hour_combination_id,
             vacant
        FROM program_editions
       WHERE edition_num_id = ANY($1::int[])`, [ids])
    return Object.fromEntries(rows.map(r => [r.edition_num_id, r]))
  }

  registerEdition (edition, userId) {
    return this.editions.register(edition, userId)
  }

  registerEditionTree (edition, userId) {
    return this.editions.treeRegister(edition, userId)
  }

  // Secuencia mas alta usada por esa version de programa en su specific_code
  // ("E19-27" -> 19). Es lo que necesita el plan para numerar los paquetes por
  // su cuenta; ver el comentario de publishItem sobre el autonumerado del arbol.
  async maxSpecificCodeSeq (programVersionId) {
    const { rows } = await this.db.query(`
      SELECT COALESCE(MAX(NULLIF(substring(specific_code FROM '^E([0-9]+)-'), '')::int), 0) AS seq
        FROM program_editions
       WHERE program_version_id = $1
         AND specific_code ~ '^E[0-9]+-[0-9]+$'`, [programVersionId])
    return Number(rows[0]?.seq || 0)
  }

  // sp_edition_tree_register solo contesta { result, message }: a diferencia de
  // sp_edition_register no devuelve el id de lo que creo. Sin ese id el plan no
  // puede marcar el paquete como publicado y volver a publicar lo duplicaria,
  // asi que se recupera la edicion recien insertada de esa version de programa.
  async lastEditionIdOf (programVersionId) {
    const { rows } = await this.db.query(`
      SELECT edition_num_id FROM program_editions
       WHERE program_version_id = $1
       ORDER BY edition_num_id DESC LIMIT 1`, [programVersionId])
    return rows[0]?.edition_num_id ?? null
  }
}

export const schedulePlanRepository = new SchedulePlanRepository()
