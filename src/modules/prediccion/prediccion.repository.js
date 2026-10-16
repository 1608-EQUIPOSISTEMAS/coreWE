import { pool } from '../../shared/db/pool.js'
import { CONVERSION_WINDOW_DAYS } from './prediccion.entity.js'

// Lee mv_commercial_history (scripts/pred-0b-commercial-history.sql): una fila
// por consulta o compra de un telefono, ERP + historico previo. Las fechas
// salen como texto para que ni el driver ni la zona horaria las corran de dia.

// Solo se sugiere lo que el asesor cobra: en vivo y presencial, sin membresias
// (online no le paga comision; decision del usuario 15/10/26).
const SUGGESTABLE_MODALITIES = [2622, 2624]

async function phoneKeyOf (rawPhone) {
  const { rows } = await pool.query('SELECT public.fn_phone_key($1) AS phone_key', [rawPhone])
  return rows[0].phone_key
}

async function historyOf (phoneKey) {
  const { rows } = await pool.query(
    `SELECT h.event_type, h.event_date::text AS event_date, h.date_kind, h.source, h.source_id,
            h.program_id, p.program_name, h.amount, u.name AS user_name
       FROM public.mv_commercial_history h
       LEFT JOIN public.programs p ON p.program_id = h.program_id
       LEFT JOIN public.users u ON u.user_id = h.user_id
      WHERE h.phone_key = $1
      ORDER BY h.event_date DESC, h.source, h.source_id DESC`,
    [phoneKey])
  return rows
}

// El historico (y los leads migrados de el) pegan al final del nombre "[]",
// "[3]" o " - 75581721 (AS:SF13)"; "-" es el nombre que nadie pregunto.
const cleanName = (expr) =>
  `NULLIF(NULLIF(TRIM(REGEXP_REPLACE(${expr}, '(\\s*(\\[[^]]*\\]|\\([^)]*\\)|-\\s*[0-9]+))+\\s*$', '')), ''), '-')`

// Nombre del cliente de un telefono (expresion SQL sobre `phoneExpr`), el mas
// confiable primero: la persona del ERP que compro, luego el ultimo lead, luego
// el historico. La usan la ficha y la bandeja: un cliente no puede llamarse
// distinto en cada una.
export const clientNameSql = (phoneExpr) => `COALESCE(
       (SELECT ${cleanName("CONCAT_WS(' ', pe.first_name, pe.last_name, pe.mother_last_name)")}
          FROM public.mv_commercial_history h
          JOIN public.enrollments e ON e.enrollment_id = h.source_id
          JOIN public.customers c ON c.customer_id = e.customer_id
          JOIN public.persons pe ON pe.person_id = c.person_id
         WHERE h.phone_key = ${phoneExpr} AND h.source = 'ERP_ENROLLMENT'
         ORDER BY h.event_date DESC LIMIT 1),
       (SELECT n.name
          FROM public.mv_commercial_history h
          JOIN public.leads l ON l.lead_id = h.source_id
         CROSS JOIN LATERAL (SELECT ${cleanName('l.full_name')} AS name) n
         WHERE h.phone_key = ${phoneExpr} AND h.source = 'ERP_LEAD' AND n.name IS NOT NULL
         ORDER BY h.event_date DESC LIMIT 1),
       (SELECT n.name
          FROM public.mv_commercial_history h
          JOIN public.consolidated c ON c.consolidated_id = h.source_id
         CROSS JOIN LATERAL (SELECT ${cleanName('c.full_name')} AS name) n
         WHERE h.phone_key = ${phoneExpr} AND h.source LIKE 'LEGACY_%' AND n.name IS NOT NULL
         ORDER BY h.event_date DESC LIMIT 1))`

async function nameOf (phoneKey) {
  const { rows } = await pool.query(`SELECT ${clientNameSql('$1')} AS name`, [phoneKey])
  return rows[0].name
}

// De quienes consultaron cada programa (consultas ERP ya maduras), cuantos lo
// compraron dentro de la ventana. Solo consultas del ERP: el historico casi no
// trae programa (26%) y sus compras tienen fecha de certificacion.
async function inquiryConversion (programIds) {
  if (!programIds.length) return []
  const { rows } = await pool.query(
    `WITH q AS (
       SELECT DISTINCT phone_key, program_id, event_date
         FROM public.mv_commercial_history
        WHERE source = 'ERP_LEAD' AND program_id = ANY($1::int[])
          AND event_date <= CURRENT_DATE - $2::int)
     SELECT q.program_id,
            COUNT(DISTINCT q.phone_key)::int AS consultaron,
            COUNT(DISTINCT q.phone_key) FILTER (WHERE EXISTS (
              SELECT 1 FROM public.mv_commercial_history c
               WHERE c.phone_key = q.phone_key AND c.program_id = q.program_id AND c.source = 'ERP_ENROLLMENT'
                 AND c.event_date BETWEEN q.event_date AND q.event_date + $2::int))::int AS compraron
       FROM q GROUP BY 1`,
    [programIds, CONVERSION_WINDOW_DAYS])
  return rows
}

// "De los que compraron X, cuantos compraron Y despues", para cada X que este
// telefono ya compro. Incluye el historico: la secuencia de compras es justo lo
// que el legacy si sabe (aunque su fecha sea la de certificacion).
async function coPurchases (phoneKey) {
  const { rows } = await pool.query(
    `WITH buys AS (
       SELECT phone_key, program_id, MIN(event_date) AS bought_on
         FROM public.mv_commercial_history
        WHERE event_type = 'COMPRA' AND program_id IS NOT NULL
        GROUP BY 1, 2),
     base AS (
       SELECT program_id, COUNT(*)::int AS buyers FROM buys
        WHERE program_id IN (SELECT program_id FROM buys WHERE phone_key = $1)
        GROUP BY 1)
     SELECT a.program_id AS from_program, b.program_id AS to_program, base.buyers,
            COUNT(*)::int AS next_buyers
       FROM buys a
       JOIN base ON base.program_id = a.program_id
       JOIN buys b ON b.phone_key = a.phone_key AND b.program_id <> a.program_id AND b.bought_on > a.bought_on
      GROUP BY 1, 2, 3`,
    [phoneKey])
  return rows
}

async function programsByIds (programIds) {
  if (!programIds.length) return []
  const { rows } = await pool.query(
    `SELECT p.program_id, p.program_name, t.tier,
            (p.cat_model_modality = ANY($2::int[]) AND NOT COALESCE(p.is_membership, false)) AS suggestable
       FROM public.programs p
       LEFT JOIN public.pred_program_tier t ON t.program_id = p.program_id
      WHERE p.program_id = ANY($1::int[])`,
    [programIds, SUGGESTABLE_MODALITIES])
  return rows
}

// Precio de lista (program_pricing: la que lee la venta, decision 06/10/26) en
// soles, de la version de la proxima edicion; sin edicion, de la ultima version
// con precio. La edicion: la proxima activa desde hoy.
const SOLES = 3041
const PROFESSIONAL = 3086
const STUDENT = 3087
const INSTALLMENTS = 2467

async function offerDetails (programIds, today) {
  if (!programIds.length) return []
  const { rows } = await pool.query(
    `WITH next_edition AS (
       SELECT DISTINCT ON (pv.program_id) pv.program_id, pe.program_version_id,
              pe.start_date::date::text AS next_start, pe.specific_code AS next_code
         FROM public.program_editions pe
         JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
        WHERE pv.program_id = ANY($1::int[]) AND pe.active = 'Y' AND pe.start_date >= $2::date
        ORDER BY pv.program_id, pe.start_date),
     priced_version AS (
       SELECT p.program_id,
              COALESCE(ne.program_version_id,
                (SELECT MAX(pv.program_version_id) FROM public.program_versions pv
                   JOIN public.program_pricing pp ON pp.program_version_id = pv.program_version_id AND pp.active
                  WHERE pv.program_id = p.program_id)) AS program_version_id
         FROM unnest($1::int[]) AS p(program_id)
         LEFT JOIN next_edition ne ON ne.program_id = p.program_id)
     SELECT v.program_id, ne.next_start, ne.next_code,
            MAX(pp.list_price) FILTER (WHERE pp.cat_profile_id = $4) AS price_professional,
            MAX(pp.list_price) FILTER (WHERE pp.cat_profile_id = $5) AS price_student,
            MAX(pp.reservation_price) FILTER (WHERE pp.cat_profile_id = $4) AS reservation
       FROM priced_version v
       LEFT JOIN next_edition ne ON ne.program_id = v.program_id
       LEFT JOIN public.program_pricing pp ON pp.program_version_id = v.program_version_id AND pp.active AND pp.cat_currency_id = $3
      GROUP BY v.program_id, ne.next_start, ne.next_code`,
    [programIds, today, SOLES, PROFESSIONAL, STUDENT])
  return rows
}

// Los NUEVOS (sin compra previa) que consultaron el programa, contados una vez
// por telefono en su primera consulta ya madura, y su primera compra del ERP
// dentro de la ventana: cuantos, que tan rapido y QUE compraron.
const FIRST_INQUIRY_OF_NEWCOMERS = `
  WITH q AS (
    SELECT DISTINCT ON (h.phone_key) h.phone_key, h.event_date AS consulted_on
      FROM public.mv_commercial_history h
     WHERE h.source = 'ERP_LEAD' AND h.program_id = $1 AND h.event_date <= $2::date - $3::int
       AND NOT EXISTS (SELECT 1 FROM public.mv_commercial_history c
                        WHERE c.phone_key = h.phone_key AND c.event_type = 'COMPRA' AND c.event_date < h.event_date)
     ORDER BY h.phone_key, h.event_date),
  b AS (
    SELECT q.phone_key, f.program_id, f.source_id AS enrollment_id, f.event_date - q.consulted_on AS dias
      FROM q CROSS JOIN LATERAL (
        SELECT c.program_id, c.event_date, c.source_id FROM public.mv_commercial_history c
         WHERE c.phone_key = q.phone_key AND c.source = 'ERP_ENROLLMENT'
           AND c.event_date BETWEEN q.consulted_on AND q.consulted_on + $3::int
         ORDER BY c.event_date LIMIT 1) f)`

async function programPlaybook (programId, today, windowDays) {
  const params = [programId, today, windowDays]
  const [{ rows: [stats] }, { rows: destinations }] = await Promise.all([
    pool.query(`${FIRST_INQUIRY_OF_NEWCOMERS}
      SELECT (SELECT COUNT(*) FROM q)::int AS consultaron, COUNT(*)::int AS compraron,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dias) AS mediana_dias,
             PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY dias) AS p90_dias,
             COUNT(*) FILTER (WHERE dias = 0)::int AS dia_0,
             COUNT(*) FILTER (WHERE dias BETWEEN 1 AND 3)::int AS dias_1_3,
             COUNT(*) FILTER (WHERE dias BETWEEN 4 AND 14)::int AS dias_4_14,
             COUNT(*) FILTER (WHERE e.cat_payment_plan = $4)::int AS en_cuotas,
             COUNT(*) FILTER (WHERE e.cat_profile_id = $5)::int AS estudiantes
        FROM b LEFT JOIN public.enrollments e ON e.enrollment_id = b.enrollment_id`, [...params, INSTALLMENTS, STUDENT]),
    pool.query(`${FIRST_INQUIRY_OF_NEWCOMERS}
      SELECT b.program_id, p.program_name, COALESCE(p.is_membership, false) AS is_membership, COUNT(*)::int AS compradores
        FROM b JOIN public.programs p ON p.program_id = b.program_id
       GROUP BY 1, 2, 3 ORDER BY 4 DESC, 2`, params)
  ])
  return { stats, destinations }
}

// Lo que el asesor puede elegir como "lo que esta pidiendo": todo programa
// activo que no sea membresia, TOP primero (lo que mas conviene vender).
async function sellablePrograms () {
  const { rows } = await pool.query(
    `SELECT p.program_id, p.program_name, COALESCE(t.tier, 'BAJO') AS tier,
            CASE p.cat_model_modality WHEN 2622 THEN 'Presencial' WHEN 2623 THEN 'Online' ELSE 'En vivo' END AS modalidad
       FROM public.programs p
       LEFT JOIN public.pred_program_tier t ON t.program_id = p.program_id
      WHERE p.active = 'Y' AND NOT COALESCE(p.is_membership, false)
      ORDER BY CASE COALESCE(t.tier, 'BAJO') WHEN 'TOP' THEN 1 WHEN 'NUEVO' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END, p.program_name`)
  return rows
}

export const prediccionRepository = {
  phoneKeyOf, historyOf, nameOf, inquiryConversion, coPurchases, programsByIds, offerDetails, programPlaybook, sellablePrograms
}
