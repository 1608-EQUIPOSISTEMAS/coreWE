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

export const prediccionRepository = { phoneKeyOf, historyOf, nameOf, inquiryConversion, coPurchases, programsByIds, offerDetails }
