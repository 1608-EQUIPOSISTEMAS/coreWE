import { pool } from '../../../shared/db/pool.js'
import { TEAM_SCOPE_SQL } from '../dashboard.repository.js'
import { IS_SALE } from './comercial.repository.js'
import { TABLE_LIMIT } from './results.entity.js'

const FICO_PENDING_STATUS = 3051
const INSTALLMENT_PENDING_STATUSES = [2470, 4452]
const INSTALLMENT_EXCLUDED_STATUSES = [4456, 3174] // anulada, borrador: nunca se cobraran
// Ventas retiradas, reprogramadas o con cambio de curso: su deuda se trasladó
// o se perdonó, y dejarlas inflaría la morosidad con plata que ya no se espera.
const MOVED_ENROLLMENT_STATUSES = [3245, 3240, 3242]

// Montos en soles. 3042 = dolares; 3.75 es el mismo tipo fijo de v_dashboard_*.
// Asume el alias `e` (enrollments).
const inSoles = (column) => `${column} * CASE WHEN e.cat_currency = 3042 THEN 3.75 ELSE 1 END`

// Primera aprobacion de cada venta. user_validator_id esta vacio en toda la
// historia, asi que quien aprobo y cuando sale de la bitacora.
const FIRST_APPROVAL_SQL = `
  SELECT DISTINCT ON (l.enrollment_id) l.enrollment_id, l.performed_at, l.performed_by
    FROM public.enrollment_audit_log l
   WHERE l.action = 'approved' AND l.performed_by IS NOT NULL
   ORDER BY l.enrollment_id, l.performed_at, l.audit_id`

// Filas crudas de los indicadores de FICO. La bandeja, el ingreso y la cobranza
// son de toda la empresa (FICO responde por todas las ventas); el ritmo y la
// tabla del equipo miden a la gente del area ($1 = roles, $2 = null).
export async function fetchFicoRaw ({ areaRoles }, db = pool) {
  const params = [areaRoles, null]
  const [bandeja, ritmo, tiempo, ingreso, ingresoDiario, porVencer, morosidad, equipo, pendientes, aprobaciones] = await Promise.all([
    db.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE e.registration_date >= LOCALTIMESTAMP - interval '1 day')::int AS menor_24h,
             COUNT(*) FILTER (WHERE e.registration_date <  LOCALTIMESTAMP - interval '1 day'
                                AND e.registration_date >= LOCALTIMESTAMP - interval '3 days')::int AS de_1_a_3,
             COUNT(*) FILTER (WHERE e.registration_date <  LOCALTIMESTAMP - interval '3 days')::int AS mayor_3
        FROM public.enrollments e
       WHERE (e.cat_fico_status = $1 OR e.cat_fico_status IS NULL)
         AND ${IS_SALE}`, [FICO_PENDING_STATUS]),

    // Mismo ritmo por hora que Comercial, sobre las aprobaciones del equipo.
    db.query(`
      WITH equipo AS (${TEAM_SCOPE_SQL}),
      aprobaciones AS (
        SELECT l.performed_at
          FROM public.enrollment_audit_log l
         WHERE l.action = 'approved'
           AND l.performed_by IN (SELECT user_id FROM equipo)
           AND l.performed_at >= CURRENT_DATE - 40
      ),
      dias AS (
        SELECT d::date AS dia
          FROM generate_series(CURRENT_DATE - 40, CURRENT_DATE - 1, interval '1 day') d
         WHERE EXTRACT(isodow FROM d) < 6
         ORDER BY d DESC
         LIMIT 20
      )
      SELECT (SELECT COUNT(*) FROM aprobaciones WHERE performed_at >= CURRENT_DATE)::int AS hoy,
             COALESCE(array_agg((SELECT COUNT(*) FROM aprobaciones a
                                  WHERE a.performed_at >= d.dia
                                    AND a.performed_at <  d.dia + LOCALTIME)::int), '{}') AS muestras
        FROM dias d`, params),

    // Horas entre que el asesor registra y FICO aprueba por primera vez. Se
    // descartan las aprobaciones en el primer minuto (o antes) del registro:
    // son importaciones, que se aprueban en el mismo segundo o traen la fecha
    // de registro reescrita, y hundirian la mediana hacia cero.
    db.query(`
      WITH primera AS (${FIRST_APPROVAL_SQL}),
      horas AS (
        SELECT p.performed_at,
               EXTRACT(epoch FROM p.performed_at - e.registration_date::timestamptz) / 3600 AS horas
          FROM primera p
          JOIN public.enrollments e ON e.enrollment_id = p.enrollment_id
         WHERE p.performed_at >= date_trunc('month', LOCALTIMESTAMP) - interval '1 month'
           AND p.performed_at >= e.registration_date::timestamptz + interval '1 minute'
      )
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY horas)
               FILTER (WHERE performed_at >= date_trunc('month', LOCALTIMESTAMP))::float AS horas_mes,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY horas)
               FILTER (WHERE performed_at <  date_trunc('month', LOCALTIMESTAMP))::float AS horas_prev
        FROM horas`),

    db.query(`
      WITH cobros AS (
        SELECT p.payment_date, ${inSoles('p.amount')} AS soles
          FROM public.payments p
          JOIN public.enrollments e ON e.enrollment_id = p.enrollment_id
         WHERE p.active = 'Y' AND e.active = 'Y'
           AND p.payment_date >= date_trunc('month', LOCALTIMESTAMP) - interval '3 months'
           AND p.payment_date <= LOCALTIMESTAMP
      ),
      mes AS (SELECT date_trunc('month', LOCALTIMESTAMP) AS inicio)
      SELECT COALESCE(SUM(c.soles) FILTER (WHERE c.payment_date >= m.inicio), 0)::float AS mes,
             COALESCE(SUM(c.soles) FILTER (WHERE c.payment_date >= m.inicio - interval '1 month'
                                             AND c.payment_date <  LOCALTIMESTAMP - interval '1 month'), 0)::float AS prev_tramo,
             ARRAY[
               COALESCE(SUM(c.soles) FILTER (WHERE c.payment_date >= m.inicio - interval '1 month'
                                               AND c.payment_date <  m.inicio), 0)::float,
               COALESCE(SUM(c.soles) FILTER (WHERE c.payment_date >= m.inicio - interval '2 months'
                                               AND c.payment_date <  m.inicio - interval '1 month'), 0)::float,
               COALESCE(SUM(c.soles) FILTER (WHERE c.payment_date >= m.inicio - interval '3 months'
                                               AND c.payment_date <  m.inicio - interval '2 months'), 0)::float
             ] AS meses_previos
        FROM mes m
        LEFT JOIN cobros c ON true
       GROUP BY m.inicio`),

    // Ingreso por día del mes en curso y del anterior, para la curva acumulada
    // del gráfico. Agregado por día y no acumulado aquí: la entity decide dónde
    // cortar (días futuros) sin otro viaje a la BD.
    db.query(`
      SELECT CASE WHEN p.payment_date >= date_trunc('month', LOCALTIMESTAMP) THEN 'actual' ELSE 'prev' END AS mes,
             EXTRACT(day FROM p.payment_date)::int AS dia,
             SUM(${inSoles('p.amount')})::float AS soles
        FROM public.payments p
        JOIN public.enrollments e ON e.enrollment_id = p.enrollment_id
       WHERE p.active = 'Y' AND e.active = 'Y'
         AND p.payment_date >= date_trunc('month', LOCALTIMESTAMP) - interval '1 month'
         AND p.payment_date <= LOCALTIMESTAMP
       GROUP BY 1, 2`),

    // La cuota 0 es la inicial: se cobra al vender, no se "vence".
    db.query(`
      SELECT COUNT(*)::int AS cuotas, COALESCE(SUM(${inSoles('pi.amount')}), 0)::float AS monto
        FROM public.payment_installments pi
        JOIN public.enrollments e ON e.enrollment_id = pi.enrollment_id
       WHERE e.active = 'Y'
         AND COALESCE(e.cat_type_status, 0) <> ALL($1::int[])
         AND pi.installment_number > 0
         AND pi.cat_status = ANY($2::int[])
         AND pi.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 6`,
    [MOVED_ENROLLMENT_STATUSES, INSTALLMENT_PENDING_STATUSES]),

    // Morosidad de la ventana de 90 dias, hoy y hace un mes. Para el corte de
    // hace un mes no basta el estado actual (lo pagado despues pareceria pagado
    // a tiempo): una cuota estaba impaga en el corte si hoy sigue pendiente o si
    // su primer pago llego despues del corte.
    db.query(`
      WITH cortes AS (
        SELECT CURRENT_DATE AS corte, 'actual' AS cual
        UNION ALL
        SELECT (CURRENT_DATE - interval '1 month')::date, 'prev'
      ),
      -- Primer pago por cuota en UNA pasada: como subconsulta correlacionada
      -- recorría payments una vez por cuota (25 s en el clon).
      primer_pago AS (
        SELECT p.installment_id, MIN(p.payment_date) AS fecha
          FROM public.payments p
         WHERE p.active = 'Y' AND p.installment_id IS NOT NULL
         GROUP BY p.installment_id
      ),
      cuotas AS (
        SELECT pi.due_date, pi.cat_status, ${inSoles('pi.amount')} AS soles,
               pp.fecha AS primer_pago
          FROM public.payment_installments pi
          JOIN public.enrollments e ON e.enrollment_id = pi.enrollment_id
          LEFT JOIN primer_pago pp ON pp.installment_id = pi.installment_id
         WHERE e.active = 'Y'
           AND COALESCE(e.cat_type_status, 0) <> ALL($1::int[])
           AND pi.installment_number > 0
           AND pi.cat_status <> ALL($2::int[])
           AND pi.due_date >= (CURRENT_DATE - interval '1 month')::date - 90
           AND pi.due_date <  CURRENT_DATE
      )
      SELECT c.cual,
             COALESCE(SUM(q.soles), 0)::float AS vencido,
             COALESCE(SUM(q.soles) FILTER (WHERE q.cat_status = ANY($3::int[])
                                             OR q.primer_pago >= c.corte), 0)::float AS impago
        FROM cortes c
        LEFT JOIN cuotas q ON q.due_date >= c.corte - 90 AND q.due_date < c.corte
       GROUP BY c.cual`,
    [MOVED_ENROLLMENT_STATUSES, INSTALLMENT_EXCLUDED_STATUSES, INSTALLMENT_PENDING_STATUSES]),

    db.query(`
      WITH equipo AS (${TEAM_SCOPE_SQL}),
      primera AS (${FIRST_APPROVAL_SQL}),
      aprobaciones AS (
        SELECT performed_by, performed_at
          FROM public.enrollment_audit_log
         WHERE action = 'approved' AND performed_at >= date_trunc('month', LOCALTIMESTAMP)
      ),
      observaciones AS (
        SELECT performed_by, COUNT(*)::int AS n
          FROM public.enrollment_audit_log
         WHERE action = 'observed' AND performed_at >= date_trunc('month', LOCALTIMESTAMP)
         GROUP BY 1
      ),
      tiempos AS (
        SELECT p.performed_by,
               percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(epoch FROM p.performed_at - e.registration_date::timestamptz) / 3600)::float AS horas
          FROM primera p
          JOIN public.enrollments e ON e.enrollment_id = p.enrollment_id
         WHERE p.performed_at >= date_trunc('month', LOCALTIMESTAMP)
           AND p.performed_at >= e.registration_date::timestamptz + interval '1 minute'
         GROUP BY 1
      )
      SELECT eq.user_id, eq.name, eq.alias,
             COUNT(a.performed_at) FILTER (WHERE a.performed_at >= CURRENT_DATE)::int AS aprobadas_hoy,
             COUNT(a.performed_at)::int AS aprobadas_mes,
             COALESCE(o.n, 0) AS observadas_mes,
             t.horas
        FROM equipo eq
        LEFT JOIN aprobaciones a ON a.performed_by = eq.user_id
        LEFT JOIN observaciones o ON o.performed_by = eq.user_id
        LEFT JOIN tiempos t ON t.performed_by = eq.user_id
       GROUP BY eq.user_id, eq.name, eq.alias, o.n, t.horas`, params),

    // Las ventas que mas esperan validacion: la lista de trabajo del lider.
    // El alumno se busca por customers -> persons (customer_id NO es person_id).
    db.query(`
      SELECT e.enrollment_id,
             TRIM(BOTH FROM concat_ws(' ', p.first_name, p.last_name, p.mother_last_name)) AS alumno,
             v.version_code AS programa,
             u.alias AS asesor,
             (CURRENT_DATE - e.registration_date::date)::int AS dias
        FROM public.enrollments e
        LEFT JOIN public.customers cu ON cu.customer_id = e.customer_id
        LEFT JOIN public.persons p ON p.person_id = cu.person_id
        LEFT JOIN public.program_versions v ON v.program_version_id = e.program_version_id
        LEFT JOIN public.users u ON u.user_id = e.seller_agent_id
       WHERE (e.cat_fico_status = $1 OR e.cat_fico_status IS NULL)
         AND ${IS_SALE}
       ORDER BY e.registration_date, e.enrollment_id
       LIMIT $2`, [FICO_PENDING_STATUS, TABLE_LIMIT]),

    // Aprobaciones del equipo en el mes contra el mismo tramo del mes anterior,
    // para el comparativo: el ingreso sin el ritmo de validacion no explica nada.
    db.query(`
      WITH equipo AS (${TEAM_SCOPE_SQL})
      SELECT COUNT(*) FILTER (WHERE l.performed_at >= date_trunc('month', LOCALTIMESTAMP))::int AS mes,
             COUNT(*) FILTER (WHERE l.performed_at <  date_trunc('month', LOCALTIMESTAMP)
                                AND l.performed_at <  LOCALTIMESTAMP - interval '1 month')::int AS prev_tramo
        FROM public.enrollment_audit_log l
       WHERE l.action = 'approved'
         AND l.performed_by IN (SELECT user_id FROM equipo)
         AND l.performed_at >= date_trunc('month', LOCALTIMESTAMP) - interval '1 month'`, params)
  ])

  return {
    bandeja: bandeja.rows[0],
    ritmo: ritmo.rows[0],
    tiempo: tiempo.rows[0],
    ingreso: ingreso.rows[0],
    ingresoDiario: ingresoDiario.rows,
    porVencer: porVencer.rows[0],
    morosidad: Object.fromEntries(morosidad.rows.map(r => [r.cual, r])),
    equipo: equipo.rows,
    pendientes: pendientes.rows,
    aprobaciones: aprobaciones.rows[0]
  }
}
