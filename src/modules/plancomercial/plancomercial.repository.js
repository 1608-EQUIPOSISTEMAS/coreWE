import { pool, withTransaction } from '../../shared/db/pool.js'
import { IS_SALE } from '../dashboard/results/comercial.repository.js'
import { RP_LINK_CTE } from '../integration/integration.repository.js'

// Plan Comercial: los objetivos cargados y los logros diarios contra los que se
// comparan. Las fechas salen como texto para que ni el driver ni la zona horaria
// del servidor las corran de dia.

const USD = 3042 // catalogo de moneda: dolares

// Una consulta borrada o anulada ya no existe administrativamente: no cuenta.
const LEAD_DISCARDED = `('we_lead_status_deleted', 'we_lead_status_annulment')`

// ── Informe Comercial ─────────────────────────────────────────────────────────
const LEAD_DISCARDED_IDS = [3199, 3136] // eliminado, anulado
const LEAD_B2B_SITUATIONS = [2533, 3237, 5057]
// Fundacion y B2B registran la consulta cuando ya vendieron (jul: 30 de 31
// convertidas): meterlas inflaria la conversion del equipo.
const FOREIGN_REGISTRAR_ROLES = ['FUNDACION', 'LIDER_FUNDACION', 'B2B', 'LIDER_B2B']
// "Canal Web" del objetivo: web wsp, cotizaciones y chatbot, o el medio WEB.
const WEB_CHANNELS = [2590, 3172, 3173]
const WEB_MEDIUM = 2590
// ponytail: Presencial cuenta como "En Vivo" (clase sincronica); si el objetivo
// es solo virtual, sacar 2622 de aqui.
const LIVE_MODALITIES = [2624, 2622]
const BLACK_PROGRAM_ID = 167
const PERU = 2329
const CHECKED = 3052
const ANNULLED = 3135
const EVENT_PROGRAM_TYPE = 2507
const OBSERVED = 3246
// Canal de la venta = categoria del lead (columna Z de "3. SYSTEM", la que mira
// Planeamiento): CM* marketing, CC* comercial (CCF es Fundacion), el resto otros.
// La web va por agent_origin: casi nunca trae consulta registrada.
const SALE_CHANNEL = `CASE
    WHEN e.agent_origin = 'WEB' THEN 'WEB'
    WHEN pr.categoria LIKE 'CM_' THEN 'MKT'
    WHEN pr.categoria LIKE 'CC_' AND pr.categoria <> 'CCF' THEN 'COM'
    ELSE 'OTROS' END`

// La F. PAGO de la hoja FICO: pay_date del lead -> primer pago -> registro. Un
// pay_date futuro o del ano 22026 (hay) no es una fecha de pago.
export const SALE_DATES_CTES = `
  lead_of AS (
    SELECT DISTINCT ON (l.enrollment_id) l.enrollment_id, l.lead_id, l.cat_code_country,
           CASE WHEN l.pay_date BETWEEN DATE '2020-01-01' AND CURRENT_DATE THEN l.pay_date END AS pay_date
      FROM public.leads l
     WHERE l.enrollment_id IS NOT NULL AND l.active = 'Y'
     ORDER BY l.enrollment_id, l.lead_id
  ),
  first_pay AS (
    SELECT enrollment_id, MIN(payment_date)::date AS dia
      FROM public.payments WHERE active = 'Y' GROUP BY enrollment_id
  )`
export const SALE_DATE = 'COALESCE(lo.pay_date, fp.dia, e.registration_date::date)'
const SALE_JOINS = `
      JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
      JOIN public.programs p ON p.program_id = pv.program_id
      LEFT JOIN lead_of lo ON lo.enrollment_id = e.enrollment_id
      LEFT JOIN first_pay fp ON fp.enrollment_id = e.enrollment_id`

// Una compra = la inscripcion raiz. RP y CC NO crean otra venta: la venta es la
// del dia que compro su primer curso (el asesor no tiene la culpa del cambio),
// asi que se cuenta el origen y se descartan el destino de la RP (raiz aparte) y
// el del CC (cuelga del origen). B2B y eventos no son venta del area; el
// COALESCE es a proposito: sin el, agent_origin NULL descarta la fila.
// Requiere rp_link en el WITH y los alias e / p.
const PURCHASE = `
         e.active = 'Y' AND e.parent_enrollment_id IS NULL
     AND COALESCE(e.cat_type_status, 0) <> ${ANNULLED}
     AND COALESCE(e.agent_origin, '') NOT IN ('B2B', 'FWE') AND e.b2b_contract_id IS NULL
     AND e.cat_event_category IS NULL AND p.cat_type_program IS DISTINCT FROM ${EVENT_PROGRAM_TYPE}
     AND NOT EXISTS (SELECT 1 FROM rp_link WHERE rp_link.destino_id = e.enrollment_id)`
// Venta del mes: compra aprobada por FICO, pagada (sin becas ni cursos incluidos
// en la membresia) y del ERP (la importacion masiva es historia, no ritmo).
const PAID_SALE = `${PURCHASE}
     AND e.cat_fico_status = ${CHECKED}
     AND COALESCE(e.total_amount, 0) > 0
     AND COALESCE(e.notes, '') NOT LIKE '%masiva FICO%'`

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
  },

  // ── Informe Comercial ───────────────────────────────────────────────────────

  // Ventas pagadas por dia de F. PAGO (el entity las junta por mes o por rango). Extranjero = telefono de otro pais o
  // venta en dolares; `con_pais` es la base (la venta web sin lead no dice pais).
  async reportSales ({ from, to }) {
    const { rows } = await this.db.query(`
      WITH ${RP_LINK_CTE}, ${SALE_DATES_CTES},
      venta AS (
        SELECT ${SALE_DATE} AS f_pago, COALESCE(p.is_membership, false) AS membresia,
               p.program_id, p.cat_model_modality, lo.cat_code_country, e.cat_currency,
               ${SALE_CHANNEL} AS canal
          FROM public.enrollments e ${SALE_JOINS}
          LEFT JOIN public.vw_r_prospectos pr ON pr.vacio_obligatorio = lo.lead_id::varchar
         WHERE ${PAID_SALE}
      )
      SELECT to_char(f_pago, 'YYYY-MM-DD') AS dia,
             COUNT(*)::int AS ventas,
             COUNT(*) FILTER (WHERE canal = 'MKT')::int AS mkt,
             COUNT(*) FILTER (WHERE canal = 'COM')::int AS com,
             COUNT(*) FILTER (WHERE canal = 'WEB')::int AS web,
             COUNT(*) FILTER (WHERE canal = 'OTROS')::int AS otros,
             COUNT(*) FILTER (WHERE NOT membresia AND cat_model_modality = ANY($3::int[]))::int AS vivo,
             COUNT(*) FILTER (WHERE membresia)::int AS membresias,
             COUNT(*) FILTER (WHERE program_id = $4)::int AS black,
             COUNT(*) FILTER (WHERE cat_code_country IS NOT NULL OR cat_currency = $6)::int AS con_pais,
             COUNT(*) FILTER (WHERE cat_code_country <> $5 OR cat_currency = $6)::int AS extranjeros
        FROM venta
       WHERE f_pago BETWEEN $1::date AND $2::date
       GROUP BY 1`, [from, to, LIVE_MODALITIES, BLACK_PROGRAM_ID, PERU, USD])
    return rows
  },

  // Por la misma F. PAGO: las ventas que FICO observo alguna vez (hoy estan en
  // Observado o el audit_logs guardo el cambio; al subsanar vuelven a Pendiente
  // y el estado solo no las ve) y los convenios (B2B, aprobados), que no son
  // venta del area. ponytail: audit_logs empieza el 17/08/26; antes solo se ven
  // las que siguen observadas.
  async reportSalesOutside ({ from, to }) {
    const { rows } = await this.db.query(`
      WITH ${RP_LINK_CTE}, ${SALE_DATES_CTES},
      observed AS (
        SELECT DISTINCT record_id::int AS enrollment_id
          FROM public.audit_logs
         WHERE table_name = 'enrollments' AND new_data->>'cat_fico_status' = ($3::int)::text
      )
      SELECT to_char(${SALE_DATE}, 'YYYY-MM-DD') AS dia,
             COUNT(*) FILTER (WHERE ${PURCHASE} AND (e.cat_fico_status = $3
                OR EXISTS (SELECT 1 FROM observed o WHERE o.enrollment_id = e.enrollment_id)))::int AS observadas,
             COUNT(*) FILTER (WHERE e.cat_fico_status = $4
                                AND (e.agent_origin = 'B2B' OR e.b2b_contract_id IS NOT NULL))::int AS convenios
        FROM public.enrollments e ${SALE_JOINS}
       WHERE e.active = 'Y' AND e.parent_enrollment_id IS NULL
         AND COALESCE(e.cat_type_status, 0) <> $5
         AND COALESCE(e.notes, '') NOT LIKE '%masiva FICO%'
         AND NOT EXISTS (SELECT 1 FROM rp_link WHERE rp_link.destino_id = e.enrollment_id)
         AND ${SALE_DATE} BETWEEN $1::date AND $2::date
       GROUP BY 1`, [from, to, OBSERVED, CHECKED, ANNULLED])
    return rows
  },

  // Conversion por flujo, igual que el panel del lider: consultas registradas en
  // el mes contra consultas con pay_date en el mes (no cohorte: la del mes en
  // curso aun no maduro). Una fila por dia x tipo de cliente x web.
  async reportConversion ({ from, to }) {
    const { rows } = await this.db.query(`
      WITH ajenos AS (
        SELECT ur.user_id FROM public.user_roles ur
          JOIN public.rol r ON r.rol_id = ur.rol_id
         WHERE UPPER(r.alias) = ANY($3::text[])
      ),
      consulta AS (
        SELECT l.registration_date,
               CASE WHEN l.pay_date <= CURRENT_DATE THEN l.pay_date END AS pay_date,
               cm.variable_2 AS tipo,
               (COALESCE(l.cat_channel, 0) = ANY($4::int[]) OR l.cat_medium_contact = $5) AS web
          FROM public.leads l
          LEFT JOIN public.catalog cm ON cm.catalog_id = l.cat_client_moment
         WHERE l.active = 'Y'
           AND COALESCE(l.cat_status_lead, 0) <> ALL($6::int[])
           AND COALESCE(l.cat_prospect_situation, 0) <> ALL($7::int[])
           AND NOT EXISTS (SELECT 1 FROM ajenos a WHERE a.user_id = l.user_registration_id)
           AND (l.registration_date >= $1::date OR l.pay_date >= $1::date)
      )
      SELECT to_char(registration_date, 'YYYY-MM-DD') AS dia, tipo, web,
             COUNT(*)::int AS consultas, 0 AS ventas
        FROM consulta
       WHERE registration_date >= $1::date AND registration_date < $2::date + 1
       GROUP BY 1, 2, 3
      UNION ALL
      SELECT to_char(pay_date, 'YYYY-MM-DD'), tipo, web, 0, COUNT(*)::int
        FROM consulta
       WHERE pay_date BETWEEN $1::date AND $2::date
       GROUP BY 1, 2, 3`,
    [from, to, FOREIGN_REGISTRAR_ROLES, WEB_CHANNELS, WEB_MEDIUM, LEAD_DISCARDED_IDS, LEAD_B2B_SITUATIONS])
    return rows
  },

  // Semanas del Plan Comercial con objetivo de vacantes que tocan el rango.
  async reportSalesGoals ({ from, to }) {
    const { rows } = await this.db.query(`
      SELECT to_char(month_start, 'YYYY-MM') AS mes,
             to_char(date_start, 'YYYY-MM-DD') AS date_start,
             to_char(date_end, 'YYYY-MM-DD') AS date_end, target_vacancies AS meta
        FROM public.commercial_plan_weeks
       WHERE target_vacancies IS NOT NULL
         AND date_start <= $2::date AND date_end >= $1::date`, [from, to])
    return rows
  },

  // Cohortes de recompra: personas cuya PRIMERA compra cae en el mes y cuantas
  // compran OTRO programa en los 12 meses siguientes. La importacion masiva
  // cuenta como historia (quien ya compro antes del ERP no es cliente nuevo),
  // pero su fecha es la de la carga, asi que no abre cohorte ni es recompra.
  // ponytail: no mira `consolidated` (compras previas al ERP por telefono); si
  // hace falta, unirla aqui como historia.
  async reportRepurchaseCohorts ({ from, to }) {
    const { rows } = await this.db.query(`
      WITH ${RP_LINK_CTE}, ${SALE_DATES_CTES},
      compra AS (
        SELECT c.person_id, e.enrollment_id, p.program_id, ${SALE_DATE} AS f_pago,
               COALESCE(e.notes, '') LIKE '%masiva FICO%' AS importada
          FROM public.enrollments e ${SALE_JOINS}
          JOIN public.customers c ON c.customer_id = e.customer_id
         WHERE ${PURCHASE}
           AND (COALESCE(e.total_amount, 0) > 0 OR COALESCE(e.notes, '') LIKE '%masiva FICO%')
      ),
      primera AS (
        SELECT DISTINCT ON (person_id) person_id, program_id, f_pago, importada
          FROM compra ORDER BY person_id, f_pago, enrollment_id
      )
      SELECT to_char(pr.f_pago, 'YYYY-MM') AS mes, COUNT(*)::int AS clientes,
             COUNT(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM compra c2
                WHERE c2.person_id = pr.person_id AND NOT c2.importada
                  AND c2.program_id <> pr.program_id
                  AND c2.f_pago > pr.f_pago AND c2.f_pago <= pr.f_pago + 365))::int AS recompraron
        FROM primera pr
       WHERE NOT pr.importada AND pr.f_pago BETWEEN $1::date AND $2::date
       GROUP BY 1`, [from, to])
    return rows
  },

  // Plan de consultas por canal de las ediciones que empiezan en el rango.
  async reportLeadPlan ({ from, to }) {
    const { rows } = await this.db.query(`
      SELECT metas_canal, canales FROM public.v_gerencia_funnel
       WHERE fecha_inicio BETWEEN $1::date AND $2::date`, [from, to])
    return rows
  },

  // Membresias Black que vencen en los proximos `days` dias y cuya persona no
  // tiene otra Black que venza despues (ya renovo). Vencimiento = arranque + 1
  // ano, igual que la hoja "5. Membresias". Incluye las migradas en 0: vencen igual.
  async reportBlackExpiring ({ days }) {
    const { rows } = await this.db.query(`
      WITH ${SALE_DATES_CTES},
      black AS (
        SELECT c.person_id, e.enrollment_id,
               (COALESCE(e.membership_activation_date::date, lo.pay_date, fp.dia, e.registration_date::date)
                  + interval '1 year')::date AS vence
          FROM public.enrollments e
          JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
          JOIN public.customers c ON c.customer_id = e.customer_id
          LEFT JOIN lead_of lo ON lo.enrollment_id = e.enrollment_id
          LEFT JOIN first_pay fp ON fp.enrollment_id = e.enrollment_id
         WHERE e.active = 'Y' AND e.parent_enrollment_id IS NULL
           AND pv.program_id = $2 AND COALESCE(e.cat_type_status, 0) <> $3
      )
      SELECT b.enrollment_id, to_char(b.vence, 'YYYY-MM-DD') AS vence,
             (b.vence - CURRENT_DATE)::int AS dias,
             TRIM(CONCAT_WS(' ', per.first_name, per.last_name, per.mother_last_name)) AS alumno
        FROM black b
        JOIN public.persons per ON per.person_id = b.person_id
       WHERE b.vence BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int
         AND NOT EXISTS (SELECT 1 FROM black b2 WHERE b2.person_id = b.person_id AND b2.vence > b.vence)
       ORDER BY b.vence, alumno`, [days, BLACK_PROGRAM_ID, ANNULLED])
    return rows
  }
}
