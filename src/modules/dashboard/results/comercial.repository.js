import { pool } from '../../../shared/db/pool.js'
import { TEAM_SCOPE_SQL } from '../dashboard.repository.js'
import { PARENT_OR_CC_DESTINATION } from '../../integration/integration.repository.js'

// Venta real enviada a FICO. La importacion masiva ('masiva FICO' en notes) se
// excluye: junio tiene 8 326 inscripciones pero 2 809 ventas padre, y contarla
// fabricaria un ritmo que ningun asesor tuvo. Asume el alias `e` (enrollments).
export const IS_SALE = `
         e.active = 'Y'${PARENT_OR_CC_DESTINATION}
         AND COALESCE(e.notes, '') NOT LIKE '%masiva FICO%'`

// Estados de lead que ya no esperan gestion: pago, inscrito, cerrado,
// desestimado, eliminado o anulado.
const LEAD_CLOSED_STATUSES = [2366, 3054, 2574, 2367, 3199, 3136]
const LEAD_DISCARDED_STATUSES = [3199, 3136] // eliminado, anulado: no son consultas
const ATTEMPT_PENDING_RESULT = 3169 // intento agendado sin resultado todavia
// Franja del grafico de ritmo: antes de las 8 y despues de las 20 casi no se vende.
const FIRST_HOUR = 8
const LAST_HOUR = 20

// Filas crudas de los indicadores de Comercial. $1 = roles del area, $2 = null
// (TEAM_SCOPE_SQL). El alcance es el vendedor de la venta y quien registro el lead.
export async function fetchComercialRaw ({ areaRoles }, db = pool) {
  const params = [areaRoles, null]
  const [ritmo, asesores, conversion, ritmoPorHora, seguimiento] = await Promise.all([
    // Ventas de hoy hasta esta hora contra lo acumulado a la MISMA hora en los
    // ultimos 20 dias habiles: a las 11:00 no se puede exigir lo del dia entero.
    db.query(`
      WITH equipo AS (${TEAM_SCOPE_SQL}),
      ventas AS (
        SELECT e.registration_date
          FROM public.enrollments e
         WHERE ${IS_SALE}
           AND e.seller_agent_id IN (SELECT user_id FROM equipo)
           AND e.registration_date >= CURRENT_DATE - 40
      ),
      dias AS (
        SELECT d::date AS dia
          FROM generate_series(CURRENT_DATE - 40, CURRENT_DATE - 1, interval '1 day') d
         WHERE EXTRACT(isodow FROM d) < 6
         ORDER BY d DESC
         LIMIT 20
      )
      SELECT (SELECT COUNT(*) FROM ventas WHERE registration_date >= CURRENT_DATE)::int AS hoy,
             COALESCE(array_agg((SELECT COUNT(*) FROM ventas v
                                  WHERE v.registration_date >= d.dia
                                    AND v.registration_date <  d.dia + LOCALTIME)::int), '{}') AS muestras
        FROM dias d`, params),

    // Una fila por asesor. mes_prev_tramo = del 1 del mes anterior hasta hoy
    // menos un mes: la comparacion justa cuando no hay meta cargada.
    // La conversion es flujo del mes (ventas por pay_date / consultas
    // registradas), no cohorte: la cohorte del mes en curso aun no maduro.
    db.query(`
      WITH equipo AS (${TEAM_SCOPE_SQL}),
      ventas AS (
        SELECT e.enrollment_id, e.seller_agent_id, e.registration_date
          FROM public.enrollments e
         WHERE ${IS_SALE}
           AND e.seller_agent_id IN (SELECT user_id FROM equipo)
           AND e.registration_date >= date_trunc('month', LOCALTIMESTAMP) - interval '1 month'
      ),
      observadas AS (
        SELECT DISTINCT enrollment_id FROM public.enrollment_audit_log WHERE action = 'observed'
      ),
      metas AS (
        SELECT seller_agent_id, SUM(target_vacancies)::int AS meta
          FROM public.sales_targets_monthly
         WHERE active = 'Y'
           AND year_period  = EXTRACT(year  FROM LOCALTIMESTAMP)::int
           AND month_period = EXTRACT(month FROM LOCALTIMESTAMP)::int
         GROUP BY 1
      ),
      consultas AS (
        SELECT l.user_registration_id AS user_id,
               COUNT(*) FILTER (WHERE l.registration_date >= date_trunc('month', LOCALTIMESTAMP)
                                  AND l.cat_status_lead <> ALL($3::int[]))::int AS consultas,
               COUNT(*) FILTER (WHERE l.pay_date >= date_trunc('month', LOCALTIMESTAMP)::date
                                  AND l.pay_date <= CURRENT_DATE)::int AS pagadas,
               COUNT(*) FILTER (WHERE l.registration_date >= LOCALTIMESTAMP - interval '30 days'
                                  AND l.cat_status_lead <> ALL($4::int[])
                                  AND NOT EXISTS (
                                        SELECT 1 FROM public.lead_contact_attempts a
                                         WHERE a.lead_id = l.lead_id
                                           AND a.cat_result IS DISTINCT FROM $5::int))::int AS sin_gestion
          FROM public.leads l
         WHERE l.user_registration_id IN (SELECT user_id FROM equipo)
           AND (l.registration_date >= LOCALTIMESTAMP - interval '31 days'
                OR l.pay_date >= date_trunc('month', LOCALTIMESTAMP)::date)
         GROUP BY 1
      )
      SELECT eq.user_id, eq.name, eq.alias,
             COUNT(v.enrollment_id) FILTER (WHERE v.registration_date >= CURRENT_DATE)::int AS hoy,
             COUNT(v.enrollment_id) FILTER (WHERE v.registration_date >= date_trunc('month', LOCALTIMESTAMP))::int AS mes,
             COUNT(v.enrollment_id) FILTER (WHERE v.registration_date <  date_trunc('month', LOCALTIMESTAMP))::int AS mes_prev,
             COUNT(v.enrollment_id) FILTER (WHERE v.registration_date <  date_trunc('month', LOCALTIMESTAMP)
                                              AND v.registration_date <  LOCALTIMESTAMP - interval '1 month')::int AS mes_prev_tramo,
             COUNT(o.enrollment_id) FILTER (WHERE v.registration_date >= date_trunc('month', LOCALTIMESTAMP))::int AS observadas,
             COUNT(o.enrollment_id) FILTER (WHERE v.registration_date <  date_trunc('month', LOCALTIMESTAMP))::int AS observadas_prev,
             m.meta,
             COALESCE(c.consultas, 0) AS consultas,
             COALESCE(c.pagadas, 0) AS pagadas,
             COALESCE(c.sin_gestion, 0) AS sin_gestion
        FROM equipo eq
        LEFT JOIN ventas v ON v.seller_agent_id = eq.user_id
        LEFT JOIN observadas o ON o.enrollment_id = v.enrollment_id
        LEFT JOIN metas m ON m.seller_agent_id = eq.user_id
        LEFT JOIN consultas c ON c.user_id = eq.user_id
       GROUP BY eq.user_id, eq.name, eq.alias, m.meta, c.consultas, c.pagadas, c.sin_gestion`,
    [...params, LEAD_DISCARDED_STATUSES, LEAD_CLOSED_STATUSES, ATTEMPT_PENDING_RESULT]),

    // Conversion de los 3 meses completos anteriores: la referencia del mes.
    db.query(`
      WITH equipo AS (${TEAM_SCOPE_SQL}),
      meses AS (
        SELECT generate_series(date_trunc('month', LOCALTIMESTAMP) - interval '3 months',
                               date_trunc('month', LOCALTIMESTAMP) - interval '1 month',
                               interval '1 month') AS inicio
      )
      SELECT to_char(m.inicio, 'YYYY-MM') AS mes,
             (SELECT COUNT(*) FROM public.leads l
               WHERE l.user_registration_id IN (SELECT user_id FROM equipo)
                 AND l.cat_status_lead <> ALL($3::int[])
                 AND l.registration_date >= m.inicio
                 AND l.registration_date <  m.inicio + interval '1 month')::int AS consultas,
             (SELECT COUNT(*) FROM public.leads l
               WHERE l.user_registration_id IN (SELECT user_id FROM equipo)
                 AND l.pay_date >= m.inicio::date
                 AND l.pay_date <  (m.inicio + interval '1 month')::date)::int AS pagadas
        FROM meses m
       ORDER BY 1`, [...params, LEAD_DISCARDED_STATUSES]),

    // La curva del gráfico principal: ventas acumuladas hasta cada hora en
    // punto, hoy contra la mediana de los ultimos 20 dias habiles. Las horas
    // que aun no llegan van en null para que la linea de hoy se corte ahi y no
    // caiga a cero.
    db.query(`
      WITH equipo AS (${TEAM_SCOPE_SQL}),
      ventas AS (
        SELECT e.registration_date
          FROM public.enrollments e
         WHERE ${IS_SALE}
           AND e.seller_agent_id IN (SELECT user_id FROM equipo)
           AND e.registration_date >= CURRENT_DATE - 40
      ),
      dias AS (
        SELECT d::date AS dia
          FROM generate_series(CURRENT_DATE - 40, CURRENT_DATE - 1, interval '1 day') d
         WHERE EXTRACT(isodow FROM d) < 6
         ORDER BY d DESC
         LIMIT 20
      ),
      horas AS (SELECT generate_series($3::int, $4::int) AS h),
      acumulado AS (
        SELECT d.dia, h.h, COUNT(v.registration_date) AS n
          FROM dias d
         CROSS JOIN horas h
          LEFT JOIN ventas v ON v.registration_date >= d.dia
                            AND v.registration_date <  d.dia + make_interval(hours => h.h)
         GROUP BY d.dia, h.h
      ),
      tipico AS (
        SELECT h, percentile_cont(0.5) WITHIN GROUP (ORDER BY n)::float AS tipico
          FROM acumulado GROUP BY h
      ),
      hoy AS (
        SELECT h.h,
               CASE WHEN CURRENT_DATE + make_interval(hours => h.h) <= LOCALTIMESTAMP
                    THEN COUNT(v.registration_date)::int END AS hoy
          FROM horas h
          LEFT JOIN ventas v ON v.registration_date >= CURRENT_DATE
                            AND v.registration_date <  CURRENT_DATE + make_interval(hours => h.h)
         GROUP BY h.h
      )
      SELECT hoy.h AS hora, hoy.hoy, COALESCE(t.tipico, 0)::float AS tipico
        FROM hoy
        LEFT JOIN tipico t ON t.h = hoy.h
       ORDER BY hoy.h`, [...params, FIRST_HOUR, LAST_HOUR]),

    // Seguimiento a clientes: de las consultas de cada asesor, cuantas
    // recibieron al menos un intento con resultado y cuantas en menos de 24 h.
    // "reciente" = ultimos 30 dias; el tramo 30-60 dias es la referencia. El
    // GROUPING SETS agrega la fila del equipo (user_id null) en la misma pasada:
    // la mediana del equipo no se puede sacar promediando medianas por asesor.
    // Los intentos se agregan una vez por lead (GROUP BY) y se unen por hash;
    // una subconsulta por lead ya costo decenas de segundos en otras areas.
    db.query(`
      WITH equipo AS (${TEAM_SCOPE_SQL}),
      consultas AS (
        SELECT l.lead_id, l.user_registration_id AS user_id, l.registration_date,
               l.registration_date >= LOCALTIMESTAMP - interval '30 days' AS reciente
          FROM public.leads l
         WHERE l.user_registration_id IN (SELECT user_id FROM equipo)
           AND l.cat_status_lead <> ALL($3::int[])
           AND l.registration_date >= LOCALTIMESTAMP - interval '60 days'
      ),
      primer_contacto AS (
        SELECT a.lead_id, MIN(COALESCE(a.contact_datetime, a.registration_date)) AS fecha
          FROM public.lead_contact_attempts a
         WHERE a.cat_result IS DISTINCT FROM $4::int
           AND a.lead_id IN (SELECT lead_id FROM consultas)
         GROUP BY a.lead_id
      )
      SELECT c.user_id, c.reciente,
             COUNT(*)::int AS consultas,
             COUNT(p.lead_id)::int AS con_seguimiento,
             COUNT(*) FILTER (WHERE p.fecha <= c.registration_date + interval '24 hours')::int AS en_24h,
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(epoch FROM p.fecha - c.registration_date) / 3600)
               FILTER (WHERE p.fecha >= c.registration_date)::float AS horas_primer_contacto
        FROM consultas c
        LEFT JOIN primer_contacto p ON p.lead_id = c.lead_id
       GROUP BY GROUPING SETS ((c.user_id, c.reciente), (c.reciente))`,
    [...params, LEAD_DISCARDED_STATUSES, ATTEMPT_PENDING_RESULT])
  ])

  return {
    ritmo: ritmo.rows[0],
    asesores: asesores.rows,
    conversionHistorica: conversion.rows,
    ritmoPorHora: ritmoPorHora.rows,
    seguimiento: seguimiento.rows
  }
}
