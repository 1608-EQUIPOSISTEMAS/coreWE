import { pool } from '../../shared/db/pool.js'

// Persistencia del dominio dashboard. Envuelve el SQL dinamico contra las vistas
// de reporteria (v_dashboard_*) y la tabla sales_targets. Devuelve filas crudas;
// la transformacion a DTO vive en la entity.
export class DashboardRepository {
  constructor (db = pool) {
    this.db = db
  }

  // Dashboard de uso (ADMIN): actividad del sistema (audit_logs como proxy de
  // tráfico), ingresos, uso por módulo, patrón horario y usuarios top.
  async adminSummary () {
    const [actividad, ingresos, hoy, modulosPorMes, topUsuarios, horas, recurrencia, habilitados] = await Promise.all([
      // Actividad mensual (7 meses): acciones + usuarios distintos
      this.db.query(`
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS mes,
               COUNT(*)::int AS acciones,
               COUNT(DISTINCT user_id)::int AS usuarios
        FROM public.audit_logs
        WHERE created_at >= date_trunc('month', now()) - interval '6 months'
          AND table_name <> 'logins'
        GROUP BY 1 ORDER BY 1`),
      // Ingresos mensuales (7 meses)
      this.db.query(`
        SELECT to_char(date_trunc('month', registration_date), 'YYYY-MM') AS mes,
               COUNT(*)::int AS inscripciones,
               COALESCE(SUM(total_amount), 0)::float AS monto
        FROM public.enrollments
        WHERE active = 'Y'
          AND registration_date >= date_trunc('month', now()) - interval '6 months'
        GROUP BY 1 ORDER BY 1`),
      this.db.query(`
        SELECT COUNT(*)::int AS inscripciones,
               COALESCE(SUM(total_amount), 0)::float AS monto
        FROM public.enrollments
        WHERE active = 'Y' AND registration_date::date = CURRENT_DATE`),
      // Acciones por tabla, mes actual y anterior (para share + variación)
      this.db.query(`
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS mes,
               table_name, COUNT(*)::int AS acciones
        FROM public.audit_logs
        WHERE created_at >= date_trunc('month', now()) - interval '1 month'
          AND table_name <> 'logins'
        GROUP BY 1, 2`),
      // Top 5 usuarios del mes con su mes anterior y la tabla que más tocan
      this.db.query(`
        SELECT u.name, u.alias,
               COUNT(*) FILTER (WHERE a.created_at >= date_trunc('month', now()))::int AS acciones,
               COUNT(*) FILTER (WHERE a.created_at <  date_trunc('month', now()))::int AS acciones_prev,
               mode() WITHIN GROUP (ORDER BY a.table_name) AS tabla_top,
               MAX(a.created_at) AS ultima_actividad
        FROM public.audit_logs a
        JOIN public.users u ON u.user_id = a.user_id
        WHERE a.created_at >= date_trunc('month', now()) - interval '1 month'
          AND a.table_name <> 'logins'
        GROUP BY u.user_id, u.name, u.alias
        HAVING COUNT(*) FILTER (WHERE a.created_at >= date_trunc('month', now())) > 0
        ORDER BY acciones DESC
        LIMIT 5`),
      // Patrón horario (30 días, día hábil): MEDIANA de acciones por hora sobre
      // la grilla completa de días — así un backfill masivo en un par de días
      // no fabrica un pico que no representa el uso típico.
      this.db.query(`
        WITH dias AS (
          SELECT d::date AS dia
          FROM generate_series(CURRENT_DATE - interval '29 days', CURRENT_DATE, interval '1 day') d
          WHERE EXTRACT(isodow FROM d) < 6
        ),
        horas AS (SELECT generate_series(0, 23) AS h),
        conteo AS (
          SELECT created_at::date AS dia, EXTRACT(hour FROM created_at)::int AS h, COUNT(*) AS n
          FROM public.audit_logs
          WHERE created_at >= CURRENT_DATE - interval '29 days'
            AND EXTRACT(isodow FROM created_at) < 6
            AND table_name <> 'logins'
          GROUP BY 1, 2
        )
        SELECT h.h AS hora,
               ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY COALESCE(c.n, 0)))::int AS acciones
        FROM dias d
        CROSS JOIN horas h
        LEFT JOIN conteo c ON c.dia = d.dia AND c.h = h.h
        GROUP BY h.h ORDER BY h.h`),
      // Recurrencia: promedio de usuarios diarios / usuarios del mes
      this.db.query(`
        SELECT COALESCE(ROUND(AVG(d.n)::numeric / NULLIF(t.total, 0) * 100), 0)::int AS pct
        FROM (SELECT created_at::date AS dia, COUNT(DISTINCT user_id) AS n
              FROM public.audit_logs
              WHERE created_at >= date_trunc('month', now())
              GROUP BY 1) d
        CROSS JOIN (SELECT COUNT(DISTINCT user_id) AS total
                    FROM public.audit_logs
                    WHERE created_at >= date_trunc('month', now())) t
        GROUP BY t.total`),
      this.db.query(`SELECT COUNT(*)::int AS n FROM public.users WHERE active = 'Y'`)
    ])

    // Últimos 5 usuarios en ingresar (eventos LOGIN de auth). Si aún no hay
    // logins registrados (feature nueva), cae a la última actividad por usuario.
    let ultimosAccesos = (await this.db.query(`
      SELECT u.name, u.alias, MAX(a.created_at) AS ingreso
      FROM public.audit_logs a
      JOIN public.users u ON u.user_id = a.user_id
      WHERE a.table_name = 'logins' AND a.action = 'LOGIN'
      GROUP BY u.user_id, u.name, u.alias
      ORDER BY ingreso DESC LIMIT 5`)).rows
    let fuenteAccesos = 'logins'
    if (!ultimosAccesos.length) {
      fuenteAccesos = 'actividad'
      ultimosAccesos = (await this.db.query(`
        SELECT u.name, u.alias, MAX(a.created_at) AS ingreso
        FROM public.audit_logs a
        JOIN public.users u ON u.user_id = a.user_id
        WHERE a.table_name <> 'logins'
        GROUP BY u.user_id, u.name, u.alias
        ORDER BY ingreso DESC LIMIT 5`)).rows
    }

    return {
      ultimosAccesos,
      fuenteAccesos,
      actividadMensual: actividad.rows,
      ingresosMensuales: ingresos.rows,
      hoy: hoy.rows[0],
      modulosPorMes: modulosPorMes.rows,
      topUsuarios: topUsuarios.rows,
      actividadPorHora: horas.rows,
      recurrencia: recurrencia.rows[0]?.pct ?? 0,
      usuariosHabilitados: habilitados.rows[0]?.n ?? 0
    }
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
