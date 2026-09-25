import { pool, withTransaction } from '../../shared/db/pool.js'
import { IS_SALE } from '../dashboard/results/comercial.repository.js'

// Plan Comercial: los objetivos cargados y los logros diarios contra los que se
// comparan. Las fechas salen como texto para que ni el driver ni la zona horaria
// del servidor las corran de dia.

const USD = 3042 // catalogo de moneda: dolares

// Una consulta borrada o anulada ya no existe administrativamente: no cuenta.
const LEAD_DISCARDED = `('we_lead_status_deleted', 'we_lead_status_annulment')`

export const planComercialRepository = {
  db: pool,

  // Las semanas cargadas del rango, cada una con el objetivo de sus asesores.
  async planWeeks ({ from, to }) {
    const { rows } = await this.db.query(`
      SELECT to_char(w.month_start, 'YYYY-MM-DD') AS month_start, w.week_label,
             to_char(w.date_start, 'YYYY-MM-DD') AS date_start,
             to_char(w.date_end, 'YYYY-MM-DD')   AS date_end,
             w.target_vacancies, w.target_revenue::float8 AS target_revenue,
             COALESCE(jsonb_object_agg(a.seller_agent_id, a.target_vacancies)
                        FILTER (WHERE a.seller_agent_id IS NOT NULL), '{}'::jsonb) AS asesores
        FROM public.commercial_plan_weeks w
        LEFT JOIN public.commercial_plan_agent_weeks a ON a.plan_week_id = w.plan_week_id
       WHERE w.date_start <= $2::date AND w.date_end >= $1::date
       GROUP BY w.plan_week_id
       ORDER BY w.date_start`, [from, to])
    return rows
  },

  // Quienes pueden llevar objetivo: el equipo comercial (el lider cuenta como
  // asesor aunque no cargue el rol raso) y la cuenta WEB, que agrupa la venta que
  // entra sola por la web. WEB esta inactiva como usuario (nadie inicia sesion
  // con ella) y aun asi es una fila del plan.
  async advisors () {
    const { rows } = await this.db.query(`
      SELECT u.user_id, u.alias, u.name
        FROM public.users u
       WHERE UPPER(u.alias) = 'WEB'
          OR (u.active = 'Y' AND EXISTS (SELECT 1 FROM public.user_roles ur
                           JOIN public.rol r ON r.rol_id = ur.rol_id
                          WHERE ur.user_id = u.user_id
                            AND UPPER(r.alias) IN ('COMERCIAL', 'LIDER_COMERCIAL')))
       ORDER BY u.alias`)
    return rows
  },

  // Logros por dia del rango: ventas por vendedor, ingresos por moneda y
  // consultas por quien las registro. Tres agregados chicos en vez de filas sueltas.
  //
  // Quien vendio lo dice agent_origin antes que seller_agent_id: la venta web y
  // la de convenios casi nunca traen vendedor (jul-sep 2026: 249 WEB y 117 B2B).
  // La web se le cuenta a la cuenta WEB para que tenga su fila y su objetivo.
  async dailyActuals ({ from, to }) {
    const range = [from, to]
    const [ventas, ingresos, consultas] = await Promise.all([
      this.db.query(`
        SELECT to_char(e.registration_date, 'YYYY-MM-DD') AS dia,
               CASE WHEN e.agent_origin = 'WEB' THEN web.user_id ELSE e.seller_agent_id END AS seller_agent_id,
               (e.agent_origin = 'B2B' OR e.b2b_contract_id IS NOT NULL) AS b2b, COUNT(*)::int AS n
          FROM public.enrollments e
          LEFT JOIN public.users web ON UPPER(web.alias) = 'WEB'
         WHERE ${IS_SALE}
           AND e.registration_date >= $1::date AND e.registration_date < $2::date + 1
         GROUP BY 1, 2, 3`, range),
      // Ingreso = lo cobrado ese dia (inicial y cuotas) de las ventas del ERP.
      this.db.query(`
        SELECT to_char(p.payment_date, 'YYYY-MM-DD') AS dia,
               (e.cat_currency = ${USD}) AS usd, SUM(p.amount)::float8 AS monto
          FROM public.payments p
          JOIN public.enrollments e ON e.enrollment_id = p.enrollment_id
         WHERE ${IS_SALE}
           AND p.active = 'Y'
           AND p.payment_date >= $1::date AND p.payment_date < $2::date + 1
         GROUP BY 1, 2`, range),
      this.db.query(`
        SELECT to_char(l.registration_date, 'YYYY-MM-DD') AS dia,
               l.user_registration_id AS user_id, COUNT(*)::int AS n
          FROM public.leads l
          LEFT JOIN public.catalog c ON c.catalog_id = l.cat_status_lead
         WHERE l.registration_date >= $1::date AND l.registration_date < $2::date + 1
           AND COALESCE(c.alias, '') NOT IN ${LEAD_DISCARDED}
         GROUP BY 1, 2`, range)
    ])
    return { ventas: ventas.rows, ingresos: ingresos.rows, consultas: consultas.rows }
  },

  // Guarda el mes entero de una vez: las semanas por su fecha de inicio y los
  // asesores reemplazados completos, asi borrar una celda borra ese objetivo.
  async saveMonth ({ weeks, userId }) {
    return withTransaction(async (client) => {
      for (const w of weeks) {
        const { rows: [{ plan_week_id: id }] } = await client.query(`
          INSERT INTO public.commercial_plan_weeks
                 (month_start, week_label, date_start, date_end,
                  target_vacancies, target_revenue, user_modification_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (date_start) DO UPDATE
             SET week_label = EXCLUDED.week_label, date_end = EXCLUDED.date_end,
                 target_vacancies = EXCLUDED.target_vacancies,
                 target_revenue = EXCLUDED.target_revenue,
                 user_modification_id = EXCLUDED.user_modification_id,
                 modification_date = LOCALTIMESTAMP
          RETURNING plan_week_id`,
        [w.month_start, w.week_label, w.date_start, w.date_end,
          w.target_vacancies, w.target_revenue, userId])

        await client.query('DELETE FROM public.commercial_plan_agent_weeks WHERE plan_week_id = $1', [id])
        if (w.asesores.length) {
          await client.query(`
            INSERT INTO public.commercial_plan_agent_weeks (plan_week_id, seller_agent_id, target_vacancies)
            SELECT $1, x.seller_agent_id, x.target_vacancies
              FROM jsonb_to_recordset($2::jsonb) AS x(seller_agent_id int, target_vacancies int)`,
          [id, JSON.stringify(w.asesores)])
        }
      }
      return { saved: weeks.length }
    })
  }
}
