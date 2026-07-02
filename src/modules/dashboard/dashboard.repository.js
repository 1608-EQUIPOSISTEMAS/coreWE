import { pool } from '../../shared/db/pool.js'

// Persistencia del dominio dashboard. Envuelve el SQL dinamico contra las vistas
// de reporteria (v_dashboard_*) y la tabla sales_targets. Devuelve filas crudas;
// la transformacion a DTO vive en la entity.
export class DashboardRepository {
  constructor (db = pool) {
    this.db = db
  }

  async dashboardComercial ({ year, modality, date_start, date_end, month, period }) {
    const params = [year, modality]
    let sql = `
    SELECT * FROM public.v_dashboard_comercial
    WHERE year_period = $1
      AND modality    = $2
  `

    if (date_start && date_end) {
      sql += ` AND fecha_inicio >= $3 AND fecha_fin <= $4`
      params.push(date_start, date_end)
    } else {
      if (month) { sql += ` AND month_period = $${params.length + 1}`; params.push(month) }
      if (period && period !== 'ALL') {
        sql += ` AND period_label = $${params.length + 1}`
        params.push(period)
      }
    }

    sql += ` ORDER BY asesor ASC`

    const { rows } = await this.db.query(sql, params)
    return rows
  }

  async programGoals ({ year, month_num }) {
    const sql = `
    SELECT * FROM public.v_dashboard_program_goals
    WHERE anio = $1
      AND mes_num = $2
    ORDER BY fecha_inicio ASC
  `
    const { rows } = await this.db.query(sql, [year, month_num])
    return rows
  }

  // Upsert masivo de metas por edición (UNIQUE en edition_num_id).
  async saveProgramGoals ({ goals, userId }) {
    const sql = `
      INSERT INTO public.program_edition_goals
        (edition_num_id, vacant_goal, revenue_goal, user_registration_id)
      SELECT * FROM unnest($1::int[], $2::int[], $3::numeric[], $4::int[])
      ON CONFLICT (edition_num_id) DO UPDATE SET
        vacant_goal = EXCLUDED.vacant_goal,
        revenue_goal = EXCLUDED.revenue_goal,
        user_modification_id = EXCLUDED.user_registration_id,
        modification_date = now()
    `
    const params = [
      goals.map(g => g.edition_num_id),
      goals.map(g => g.target_vacants ?? 0),
      goals.map(g => g.target_revenue ?? 0),
      goals.map(() => userId)
    ]
    const { rowCount } = await this.db.query(sql, params)
    return { saved: rowCount }
  }

  async registerTarget (target) {
    const sql = `
      INSERT INTO public.sales_targets
      (seller_agent_id, year_period, month_period, period_label, date_start, date_end, target_vacancies, target_revenue)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING target_id
    `
    const values = [
      target.seller_agent_id,
      target.year,
      target.month,
      target.period,
      target.date_start,
      target.date_end,
      target.target_vacancies,
      target.target_revenue
    ]

    const { rows } = await this.db.query(sql, values)
    return { target_id: rows[0]?.target_id }
  }

  async availableWeeks ({ year, modality }) {
    const sql = `
    SELECT
      period_label,
      month_period,
      MIN(date_start)::date AS date_start,
      MAX(date_end)::date   AS date_end
    FROM sales_targets
    WHERE year_period = $1
      AND active      = 'Y'
      AND modality    = $2
    GROUP BY period_label, month_period
    ORDER BY MIN(date_start) ASC
  `
    const { rows } = await this.db.query(sql, [year, modality])
    return rows
  }

  async lider ({ year, month, advisor }) {
    let sql = `SELECT * FROM public.v_dashboard_lider WHERE anio = $1`
    const params = [year]

    if (month && month !== 0 && month !== '0') {
      params.push(month)
      sql += ` AND mes_num = $${params.length}`
    }

    if (advisor && advisor !== 'all') {
      params.push(advisor)
      sql += ` AND cod_asesor = $${params.length}`
    }

    sql += ` ORDER BY total_sin_atencion DESC`

    const { rows } = await this.db.query(sql, params)
    return rows
  }

  async contactability ({ year, month, advisor }) {
    let sql = `SELECT * FROM public.v_dashboard_contactability WHERE anio = $1`
    const params = [year]

    if (month && month !== 0 && month !== '0') {
      params.push(month)
      sql += ` AND mes_num = $${params.length}`
    }

    if (advisor && advisor !== 'all') {
      params.push(advisor)
      sql += ` AND cod_asesor = $${params.length}`
    }

    sql += ` ORDER BY tasa_conversion DESC`

    const { rows } = await this.db.query(sql, params)
    return rows
  }

  async ventasCanal ({ year, month_num, advisor }) {
    let sql = `
    SELECT * FROM public.v_dashboard_ventas_canal
    WHERE anio = $1
      AND mes_num = $2
  `
    const params = [year, month_num]

    if (advisor && advisor !== 'all') {
      params.push(advisor)
      sql += ` AND cod_asesor = $${params.length}`
    }

    sql += ` ORDER BY semana_mes ASC`

    const { rows } = await this.db.query(sql, params)
    return rows
  }

  async detailLeads ({ cod_asesor, date, size, offset }) {
    let sql = `SELECT * FROM public.v_dashboard_detail_leads WHERE fecha_registro = $1`
    const params = [date]

    if (cod_asesor && cod_asesor !== 'ALL') {
      params.push(cod_asesor)
      sql += ` AND cod_asesor = $${params.length}`
    }

    params.push(size, offset)
    sql += ` ORDER BY hora_registro DESC LIMIT $${params.length - 1} OFFSET $${params.length}`

    const { rows } = await this.db.query(sql, params)
    return rows
  }

  async detailSales ({ cod_asesor, date, size, offset }) {
    let sql = `SELECT * FROM public.v_dashboard_detail_sales WHERE fecha_venta = $1`
    const params = [date]

    if (cod_asesor && cod_asesor !== 'ALL') {
      params.push(cod_asesor)
      sql += ` AND cod_asesor = $${params.length}`
    }

    params.push(size, offset)
    sql += ` ORDER BY hora_venta DESC LIMIT $${params.length - 1} OFFSET $${params.length}`

    const { rows } = await this.db.query(sql, params)
    return rows
  }

  // Nº de consultas (leads) por edición. La tabla leads ya enlaza a la edición
  // vía program_edition_id (= program_editions.edition_num_id). Se cuenta sobre
  // los ids ya visibles en pantalla, así no dependemos de la fecha del lead.
  async leadsPerEdition ({ edition_ids = [] }) {
    if (!edition_ids.length) return []
    const sql = `
    SELECT program_edition_id AS edition_num_id, COUNT(*)::int AS consultas
    FROM public.leads
    WHERE program_edition_id = ANY($1::int[])
    GROUP BY program_edition_id
  `
    const { rows } = await this.db.query(sql, [edition_ids])
    return rows
  }
}

export const dashboardRepository = new DashboardRepository()
