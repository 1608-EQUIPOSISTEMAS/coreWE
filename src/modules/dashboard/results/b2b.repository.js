import { pool } from '../../../shared/db/pool.js'
import {
  IS_B2B, NOT_FICO_OPERATOR, PARENT_OR_CC_DESTINATION, EXCLUDE_IMPORTED
} from '../../integration/integration.repository.js'
import { RANKING_LIMIT } from './results.entity.js'

// Filas crudas del panel B2B. Una venta es de convenios por el marcador IS_B2B
// (el mismo de la hoja "7. Convenios"), no por quién la registró: el alcance del
// líder no filtra estas consultas.

// FROM + WHERE de una venta B2B viva. Arma los alias que IS_B2B asume: `u`
// (asesor, sin operadores FICO), `l` (lead) y `ag_token` (asesor del token).
const B2B_SALES = `
    FROM public.enrollments e
    LEFT JOIN public.users u ON u.user_id = e.seller_agent_id AND ${NOT_FICO_OPERATOR('u')}
    LEFT JOIN public.catalog st ON st.catalog_id = e.cat_type_status
    -- Una venta puede tener varios leads; basta que UNO sea b2b: MAX('Y','N') = 'Y'.
    -- Agregado una sola vez y no como LATERAL: leads.enrollment_id no tiene
    -- índice y el LATERAL recorría la tabla entera por cada venta (~55 s).
    LEFT JOIN (
      SELECT l2.enrollment_id, MAX(l2.b2b) AS b2b
        FROM public.leads l2
       WHERE l2.enrollment_id IS NOT NULL
       GROUP BY l2.enrollment_id
    ) l ON l.enrollment_id = e.enrollment_id
    LEFT JOIN LATERAL (
      SELECT u_pt.alias
        FROM public.payment_tokens pt
        LEFT JOIN public.users u_pt ON u_pt.user_id = COALESCE(pt.requested_by, pt.created_by)
                                   AND ${NOT_FICO_OPERATOR('u_pt')}
       WHERE pt.enrollment_id = e.enrollment_id
       ORDER BY pt.token_id ASC
       LIMIT 1
    ) ag_token ON TRUE
   WHERE e.active = 'Y'
     AND COALESCE(st.alias, '') NOT IN ('we_enrollment_status_retired', 'we_enrollment_status_reprogrammed',
                                        'we_enrollment_status_course_changed', 'we_enrollment_status_annulment')
     ${IS_B2B}
     ${PARENT_OR_CC_DESTINATION}
     ${EXCLUDE_IMPORTED}`

// Mes en curso (meses_atras 0) y los 6 anteriores, con los meses vacíos en cero
// para que la mediana no vea solo los meses con movimiento.
const LAST_SEVEN_MONTHS = `
  meses AS (
    SELECT gs::date AS mes, (row_number() OVER (ORDER BY gs DESC) - 1)::int AS meses_atras
      FROM generate_series(date_trunc('month', current_date) - interval '6 months',
                           date_trunc('month', current_date), interval '1 month') gs
  )`

// USD a soles con el tipo fijo de v_gerencia_funnel. El pago se registra en la
// moneda de su venta, así que se convierte con la de la venta.
const TO_PEN = (amount) => `CASE WHEN e.cat_currency = 3042 THEN ${amount} * 3.75 ELSE ${amount} END`

// El alcance (primer argumento) no se usa: B2B se mide por el marcador de la venta.
export async function fetchB2bRaw (_scope, db = pool) {
  const [cobranza, ventas, leads, programas] = await Promise.all([
    // monto_al_dia = lo cobrado del 1 al día de hoy de cada mes: el tramo
    // comparable con el mes en curso.
    db.query(`
      WITH ${LAST_SEVEN_MONTHS},
      cobro AS (
        SELECT date_trunc('month', p.payment_date)::date AS mes, p.payment_date::date AS dia,
               ${TO_PEN('p.amount')} AS monto
          FROM public.payments p
          JOIN public.enrollments e ON e.enrollment_id = p.enrollment_id
         WHERE p.active = 'Y'
           AND p.payment_date >= date_trunc('month', current_date) - interval '6 months'
           AND p.payment_date::date <= current_date
           AND e.enrollment_id IN (SELECT e.enrollment_id ${B2B_SALES})
      )
      SELECT m.meses_atras,
             COALESCE(sum(c.monto), 0)::float AS monto,
             COALESCE(sum(c.monto) FILTER (WHERE extract(day FROM c.dia) <= extract(day FROM current_date)), 0)::float AS monto_al_dia
        FROM meses m
        LEFT JOIN cobro c ON c.mes = m.mes
       GROUP BY m.meses_atras
       ORDER BY m.meses_atras`),

    // Cupo = venta en S/0: el convenio se cobra en el contrato y el alumno entra
    // sin monto. Se cuenta aparte para que no se lea como venta regalada.
    db.query(`
      WITH ${LAST_SEVEN_MONTHS},
      v AS (
        SELECT date_trunc('month', e.registration_date)::date AS mes, ${TO_PEN('e.total_amount')} AS monto
        ${B2B_SALES}
          AND e.registration_date >= date_trunc('month', current_date) - interval '6 months'
          AND e.registration_date::date <= current_date
      )
      SELECT m.meses_atras,
             count(v.mes)::int AS ventas,
             COALESCE(sum(v.monto), 0)::float AS monto,
             count(*) FILTER (WHERE v.monto = 0)::int AS cupos
        FROM meses m
        LEFT JOIN v ON v.mes = m.mes
       GROUP BY m.meses_atras
       ORDER BY m.meses_atras`),

    // Conversión de los leads de los últimos 90 días contra los 90 anteriores.
    // pay_date se acota: hay fechas basura (año 22026, anteriores a 2020).
    // Lead B2B: desde marzo/26 ya no se marca b2b='Y' sino la situación de
    // prospecto (2533 corporativa, 3237 convenio, 5057 convenios); solo con
    // b2b='Y' el indicador quedaba en cero.
    db.query(`
      SELECT count(*) FILTER (WHERE l.registration_date >= current_date - 90)::int AS leads,
             count(*) FILTER (WHERE l.registration_date >= current_date - 90 AND l.pay_date BETWEEN DATE '2020-01-01' AND current_date)::int AS pagados,
             count(*) FILTER (WHERE l.registration_date < current_date - 90)::int AS leads_prev,
             count(*) FILTER (WHERE l.registration_date < current_date - 90 AND l.pay_date BETWEEN DATE '2020-01-01' AND current_date)::int AS pagados_prev,
             count(*) FILTER (WHERE l.registration_date >= date_trunc('month', current_date))::int AS leads_mes
        FROM public.leads l
       WHERE (l.b2b = 'Y' OR l.cat_prospect_situation IN (2533, 3237, 5057))
         AND l.active = 'Y'
         AND COALESCE(l.cat_status_lead, 0) NOT IN (3199, 3136)
         AND l.registration_date >= current_date - 180
         AND l.registration_date::date <= current_date`),

    // Top de programas B2B del mes. Es por programa y no por empresa a propósito:
    // en 2026 ni leads.company_id ni enrollments.b2b_contract_id vienen cargados,
    // así que un "top de empresas" saldría vacío o inventado.
    db.query(`
      SELECT p.program_name AS programa, count(*)::int AS ventas, COALESCE(sum(v.monto), 0)::float AS monto
        FROM (SELECT e.program_version_id, ${TO_PEN('e.total_amount')} AS monto
              ${B2B_SALES}
                AND e.registration_date >= date_trunc('month', current_date)
                AND e.registration_date::date <= current_date) v
        JOIN public.program_versions pv ON pv.program_version_id = v.program_version_id
        JOIN public.programs p ON p.program_id = pv.program_id
       GROUP BY p.program_name
       ORDER BY ventas DESC, monto DESC
       LIMIT $1`, [RANKING_LIMIT])
  ])

  return {
    cobranzaPorMes: cobranza.rows,
    ventasPorMes: ventas.rows,
    leads: leads.rows[0],
    programas: programas.rows
  }
}
