import { pool } from '../../shared/db/pool.js'
import { FIRST_ELIGIBLE_DAY, LAST_ELIGIBLE_DAY, COOLDOWN_DAYS } from './bandeja.entity.js'
import { clientNameSql } from './prediccion.repository.js'

// Bandeja "Llamar hoy" (pred_call_assignments, scripts/pred-2-bandeja.sql).
// Las escrituras reciben el client de la transaccion; las lecturas usan el pool.

// Compro despues de asignado (cualquier programa): la llamada cumplio. Se mira la
// venta del ERP, no el historico, que no trae fecha de compra. Todo "a la fecha"
// (<= today): sin ese tope, generar en una fecha pasada (prueba A/A) veia el futuro.
async function closePurchased (db, today) {
  const { rowCount } = await db.query(
    `UPDATE public.pred_call_assignments a
        SET outcome = 'COMPRO', outcome_at = now()
      WHERE a.outcome IS NULL
        AND EXISTS (SELECT 1 FROM public.mv_commercial_history h
                     WHERE h.phone_key = a.phone_key AND h.source = 'ERP_ENROLLMENT'
                       AND h.event_date BETWEEN a.assigned_on AND $1::date)`, [today])
  return rowCount
}

async function expireOverdue (db, today) {
  const { rowCount } = await db.query(
    `UPDATE public.pred_call_assignments SET outcome = 'VENCIDO', outcome_at = now()
      WHERE outcome IS NULL AND expires_on < $1::date`, [today])
  return rowCount
}

// Cliente (compro antes) cuya ultima consulta del ERP fue hace 15-120 dias y que
// no compro desde entonces. Fuera: quien ya esta en una bandeja, quien se cerro
// hace menos de 30 dias y el numero errado (hasta que vuelva a consultar).
async function candidates (db, today) {
  const { rows } = await db.query(
    `WITH last_inquiry AS (
       SELECT DISTINCT ON (phone_key) phone_key, program_id, event_date AS consulted_on, source_id AS lead_id
         FROM public.mv_commercial_history
        WHERE source = 'ERP_LEAD' AND event_date BETWEEN $1::date - $3::int AND $1::date - $2::int
        ORDER BY phone_key, event_date DESC, source_id DESC)
     SELECT li.phone_key, li.program_id, li.lead_id, li.consulted_on::text AS consulted_on, t.tier,
            ${clientNameSql('li.phone_key')} AS client_name,
            (SELECT COUNT(*)::int FROM public.mv_commercial_history h
              WHERE h.phone_key = li.phone_key AND h.source = 'ERP_LEAD'
                AND h.program_id IS NOT DISTINCT FROM li.program_id AND h.event_date <= li.consulted_on) AS inquiries
       FROM last_inquiry li
       LEFT JOIN public.pred_program_tier t ON t.program_id = li.program_id
      WHERE EXISTS (SELECT 1 FROM public.mv_commercial_history c
                     WHERE c.phone_key = li.phone_key AND c.event_type = 'COMPRA' AND c.event_date < li.consulted_on)
        AND NOT EXISTS (SELECT 1 FROM public.mv_commercial_history c
                         WHERE c.phone_key = li.phone_key AND c.source = 'ERP_ENROLLMENT'
                           AND c.event_date BETWEEN li.consulted_on AND $1::date)
        AND NOT EXISTS (SELECT 1 FROM public.pred_call_assignments a
                         WHERE a.phone_key = li.phone_key
                           AND (a.outcome IS NULL
                                OR a.assigned_on > $1::date - $4::int
                                OR (a.outcome = 'NUMERO_ERRADO' AND a.outcome_at::date >= li.consulted_on)))`,
    [today, FIRST_ELIGIBLE_DAY, LAST_ELIGIBLE_DAY, COOLDOWN_DAYS])
  return rows
}

// Asesor elegible = COMERCIAL o LIDER_COMERCIAL activo (el lider solo ya cuenta,
// regla del 10/09/26). La cuenta WEB no llama a nadie.
async function advisorsWithLoad (db = pool) {
  const { rows } = await db.query(
    `SELECT u.user_id, u.alias, u.name,
            (SELECT COUNT(*)::int FROM public.pred_call_assignments a
              WHERE a.user_id = u.user_id AND a.outcome IS NULL) AS open
       FROM public.users u
      WHERE u.active = 'Y' AND UPPER(u.alias) <> 'WEB'
        AND EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.rol r ON r.rol_id = ur.rol_id
                     WHERE ur.user_id = u.user_id AND UPPER(r.alias) IN ('COMERCIAL', 'LIDER_COMERCIAL'))
      ORDER BY u.user_id`)
  return rows
}

async function insertAssignments (db, assignments, { today, expiresOn }) {
  if (!assignments.length) return 0
  const { rowCount } = await db.query(
    `INSERT INTO public.pred_call_assignments
       (phone_key, client_name, program_id, lead_id, consulted_on, inquiries, probability, tier, user_id, is_control, assigned_on, expires_on)
     SELECT x.phone_key, x.client_name, x.program_id, x.lead_id, x.consulted_on, x.inquiries, x.probability, x.tier, x.user_id,
            COALESCE(x.is_control, false), $2::date, $3::date
       FROM jsonb_to_recordset($1::jsonb) AS x(phone_key text, client_name text, program_id int, lead_id int, consulted_on date,
                                               inquiries int, probability numeric, tier text, user_id int, is_control boolean)`,
    [JSON.stringify(assignments), today, expiresOn])
  return rowCount
}

async function openAssignmentsOf (userId) {
  const { rows } = await pool.query(
    `SELECT a.assignment_id, a.phone_key, a.client_name, a.program_id, p.program_name, a.lead_id,
            a.consulted_on::text AS consulted_on, a.inquiries, a.probability::float AS probability, a.tier,
            a.assigned_on::text AS assigned_on, a.expires_on::text AS expires_on
       FROM public.pred_call_assignments a
       LEFT JOIN public.programs p ON p.program_id = a.program_id
      WHERE a.user_id = $1 AND a.outcome IS NULL
      ORDER BY a.probability DESC, a.assigned_on, a.assignment_id`,
    [userId])
  return rows
}

// Lo cerrado del asesor desde una fecha: cuantos de cada resultado y cuantas
// compras se esperaban (suma de probabilidades), para comparar contra lo real.
async function closedSince (userId, since) {
  const { rows } = await pool.query(
    `SELECT outcome, COUNT(*)::int AS total, COALESCE(SUM(probability), 0)::float AS expected_pct
       FROM public.pred_call_assignments
      WHERE user_id = $1 AND outcome IS NOT NULL AND assigned_on >= $2::date
      GROUP BY outcome`,
    [userId, since])
  return rows
}

async function assignmentById (assignmentId) {
  const { rows } = await pool.query(
    'SELECT assignment_id, user_id, outcome, is_control FROM public.pred_call_assignments WHERE assignment_id = $1', [assignmentId])
  return rows[0] ?? null
}

async function saveOutcome ({ assignmentId, outcome, reason, userId }) {
  const { rowCount } = await pool.query(
    `UPDATE public.pred_call_assignments SET outcome = $2, no_buy_reason = $3, outcome_at = now(), outcome_by = $4
      WHERE assignment_id = $1 AND outcome IS NULL AND NOT is_control`,
    [assignmentId, outcome, reason, userId])
  return rowCount
}

// Asignaciones ya maduras (paso la ventana) por grupo y segmento. Compro = venta
// del ERP de CUALQUIER programa dentro de la ventana, registre o no el asesor el
// resultado (si marco "Contesto" y compro al dia 10, cuenta igual).
async function measurementRows (today, windowDays) {
  const { rows } = await pool.query(
    `SELECT a.is_control, a.probability::float AS probability, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM public.mv_commercial_history h
               WHERE h.phone_key = a.phone_key AND h.source = 'ERP_ENROLLMENT'
                 AND h.event_date BETWEEN a.assigned_on AND a.assigned_on + ($2::int - 1)))::int AS compraron
       FROM public.pred_call_assignments a
      WHERE a.assigned_on <= $1::date - $2::int
      GROUP BY 1, 2`,
    [today, windowDays])
  return rows
}

// Cuando hay datos para medir y cuanto se trabajo la bandeja: sin resultados
// registrados, la comparacion mediria la bandeja sin usar, no la bandeja.
async function measurementStatus (today, windowDays) {
  const { rows } = await pool.query(
    `SELECT (MIN(assigned_on) + $2::int)::text AS first_mature,
            COUNT(*) FILTER (WHERE assigned_on > $1::date - $2::int)::int AS madurando,
            COUNT(*) FILTER (WHERE NOT is_control)::int AS llamables,
            COUNT(*) FILTER (WHERE NOT is_control AND outcome IN ('CONTESTO', 'NO_INTERESA', 'NO_CONTESTA', 'NUMERO_ERRADO'))::int AS con_resultado,
            COUNT(*) FILTER (WHERE NOT is_control AND outcome = 'VENCIDO')::int AS vencidos
       FROM public.pred_call_assignments`,
    [today, windowDays])
  return rows[0]
}

async function noBuyReasons (since) {
  const { rows } = await pool.query(
    `SELECT no_buy_reason AS reason, COUNT(*)::int AS total
       FROM public.pred_call_assignments
      WHERE no_buy_reason IS NOT NULL AND outcome_at >= $1::date
      GROUP BY 1 ORDER BY 2 DESC`,
    [since])
  return rows
}

export const bandejaRepository = {
  closePurchased, expireOverdue, candidates, advisorsWithLoad, insertAssignments,
  openAssignmentsOf, closedSince, assignmentById, saveOutcome, measurementRows, measurementStatus, noBuyReasons
}
