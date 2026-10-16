import { pool } from '../../shared/db/pool.js'
import { LAST_ELIGIBLE_DAY, COOLDOWN_DAYS } from './bandeja.entity.js'
import { clientNameSql } from './prediccion.repository.js'

// Bandeja "Llamar hoy" (pred_call_assignments, pred_call_log, pred_followups:
// scripts/pred-2-bandeja.sql + pred-6-bandeja-v2.sql). Las escrituras reciben el
// client de la transaccion; las lecturas usan el pool.

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

// Lo vencido sale de la bandeja y entra a la cadencia: el 26-29% de las compras
// llega despues del dia 14 (16/10/26), no se suelta.
async function expireOverdue (db, today) {
  const { rows } = await db.query(
    `UPDATE public.pred_call_assignments SET outcome = 'VENCIDO', outcome_at = now()
      WHERE outcome IS NULL AND expires_on < $1::date
      RETURNING phone_key, client_name, program_id, user_id, is_control`, [today])
  return rows.filter((r) => !r.is_control)
}

// Toda ultima consulta del ERP de los ultimos 120 dias sin compra posterior; el
// entity decide quien se llama (ALTA/MEDIA) y quien va a la cadencia (BAJA).
// Fuera: quien ya esta en una bandeja, quien se cerro hace menos de 30 dias y el
// numero errado (hasta que vuelva a consultar).
async function candidates (db, today) {
  const { rows } = await db.query(
    `WITH last_inquiry AS (
       SELECT DISTINCT ON (phone_key) phone_key, program_id, event_date AS consulted_on, source_id AS lead_id, user_id AS owner_id
         FROM public.mv_commercial_history
        WHERE source = 'ERP_LEAD' AND event_date BETWEEN $1::date - $2::int AND $1::date
        ORDER BY phone_key, event_date DESC, source_id DESC)
     SELECT li.phone_key, li.program_id, li.lead_id, li.owner_id, li.consulted_on::text AS consulted_on,
            ($1::date - li.consulted_on) AS days, t.tier,
            ${clientNameSql('li.phone_key')} AS client_name,
            (SELECT COUNT(*)::int FROM public.mv_commercial_history h
              WHERE h.phone_key = li.phone_key AND h.source = 'ERP_LEAD'
                AND h.program_id IS NOT DISTINCT FROM li.program_id AND h.event_date <= li.consulted_on) AS inquiries,
            EXISTS (SELECT 1 FROM public.mv_commercial_history c
                     WHERE c.phone_key = li.phone_key AND c.event_type = 'COMPRA' AND c.event_date < li.consulted_on) AS is_client
       FROM last_inquiry li
       LEFT JOIN public.pred_program_tier t ON t.program_id = li.program_id
      WHERE NOT EXISTS (SELECT 1 FROM public.mv_commercial_history c
                         WHERE c.phone_key = li.phone_key AND c.source = 'ERP_ENROLLMENT'
                           AND c.event_date BETWEEN li.consulted_on AND $1::date)
        AND NOT EXISTS (SELECT 1 FROM public.pred_call_assignments a
                         WHERE a.phone_key = li.phone_key
                           AND (a.outcome IS NULL
                                OR a.assigned_on > $1::date - $3::int
                                OR (a.outcome = 'NUMERO_ERRADO' AND a.outcome_at::date >= li.consulted_on)))`,
    [today, LAST_ELIGIBLE_DAY, COOLDOWN_DAYS])
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
       (phone_key, client_name, program_id, lead_id, consulted_on, inquiries, is_client, level, probability, tier, user_id, is_control, assigned_on, expires_on)
     SELECT x.phone_key, x.client_name, x.program_id, x.lead_id, x.consulted_on, x.inquiries, x.is_client, x.level, x.probability, x.tier, x.user_id,
            COALESCE(x.is_control, false), $2::date, $3::date
       FROM jsonb_to_recordset($1::jsonb) AS x(phone_key text, client_name text, program_id int, lead_id int, consulted_on date,
                                               inquiries int, is_client boolean, level text, probability numeric, tier text,
                                               user_id int, is_control boolean)`,
    [JSON.stringify(assignments), today, expiresOn])
  return rowCount
}

// followups: { phone_key, client_name, program_id, user_id, reason, anchor_on, step, due_on }.
// Repetir el mismo dia no duplica: un telefono tiene un solo paso por ancla.
async function insertFollowups (db, followups) {
  if (!followups.length) return 0
  const { rowCount } = await db.query(
    `INSERT INTO public.pred_followups (phone_key, client_name, program_id, user_id, reason, anchor_on, step, due_on)
     SELECT x.phone_key, x.client_name, x.program_id, x.user_id, x.reason, x.anchor_on, x.step, x.due_on
       FROM jsonb_to_recordset($1::jsonb) AS x(phone_key text, client_name text, program_id int, user_id int,
                                               reason text, anchor_on date, step smallint, due_on date)
     ON CONFLICT (phone_key, anchor_on, step) DO NOTHING`,
    [JSON.stringify(followups)])
  return rowCount
}

// Compro o subio a Llamar hoy (volvio a consultar): la cadencia ya no aplica.
async function cancelStaleFollowups (db, today) {
  const { rowCount } = await db.query(
    `UPDATE public.pred_followups f SET cancelled_at = now()
      WHERE f.done_at IS NULL AND f.cancelled_at IS NULL
        AND (EXISTS (SELECT 1 FROM public.pred_call_assignments a WHERE a.phone_key = f.phone_key AND a.outcome IS NULL)
             OR EXISTS (SELECT 1 FROM public.mv_commercial_history h
                         WHERE h.phone_key = f.phone_key AND h.source = 'ERP_ENROLLMENT'
                           AND h.event_date BETWEEN f.anchor_on AND $1::date))`, [today])
  return rowCount
}

// Lo que el asesor ve hoy: lo nuevo y lo reprogramado para hoy o antes.
async function openAssignmentsOf (userId, today) {
  const { rows } = await pool.query(
    `SELECT a.assignment_id, a.phone_key, a.client_name, a.program_id, p.program_name, a.lead_id,
            a.consulted_on::text AS consulted_on, a.inquiries, a.is_client, a.level, a.tier, a.attempts, a.last_result,
            a.assigned_on::text AS assigned_on, a.expires_on::text AS expires_on
       FROM public.pred_call_assignments a
       LEFT JOIN public.programs p ON p.program_id = a.program_id
      WHERE a.user_id = $1 AND a.outcome IS NULL AND (a.next_contact_on IS NULL OR a.next_contact_on <= $2::date)
      ORDER BY CASE a.level WHEN 'ALTA' THEN 0 ELSE 1 END, a.consulted_on DESC, a.assignment_id`,
    [userId, today])
  return rows
}

// Cuantos clientes distintos trabajo hoy el asesor ("Contactados hoy 7/20").
async function contactedOn (userId, today) {
  const { rows: [r] } = await pool.query(
    `SELECT COUNT(DISTINCT assignment_id)::int AS total FROM public.pred_call_log
      WHERE user_id = $1 AND (created_at AT TIME ZONE 'America/Lima')::date = $2::date`,
    [userId, today])
  return r.total
}

async function followupsDueOf (userId, today) {
  const { rows } = await pool.query(
    `SELECT f.followup_id, f.phone_key, f.client_name, f.program_id, p.program_name, f.reason, f.step,
            f.anchor_on::text AS anchor_on, f.due_on::text AS due_on
       FROM public.pred_followups f
       LEFT JOIN public.programs p ON p.program_id = f.program_id
      WHERE f.user_id = $1 AND f.due_on <= $2::date AND f.done_at IS NULL AND f.cancelled_at IS NULL
      ORDER BY f.due_on, f.followup_id`,
    [userId, today])
  return rows
}

async function followupById (followupId) {
  const { rows } = await pool.query('SELECT followup_id, user_id, done_at FROM public.pred_followups WHERE followup_id = $1', [followupId])
  return rows[0] ?? null
}

async function markFollowupDone (followupId) {
  const { rowCount } = await pool.query(
    'UPDATE public.pred_followups SET done_at = now() WHERE followup_id = $1 AND done_at IS NULL AND cancelled_at IS NULL', [followupId])
  return rowCount
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

async function assignmentById (db, assignmentId) {
  const { rows } = await db.query(
    `SELECT assignment_id, phone_key, client_name, program_id, user_id, outcome, is_control, attempts
       FROM public.pred_call_assignments WHERE assignment_id = $1 FOR UPDATE`, [assignmentId])
  return rows[0] ?? null
}

async function logCall (db, { assignment, outcome, userId }) {
  await db.query(
    'INSERT INTO public.pred_call_log (assignment_id, phone_key, outcome, user_id) VALUES ($1, $2, $3, $4)',
    [assignment.assignment_id, assignment.phone_key, outcome, userId])
}

// step = nextStep() del entity: cierra o reprograma.
async function applyStep (db, { assignmentId, outcome, step, userId }) {
  await db.query(
    `UPDATE public.pred_call_assignments
        SET outcome = $2, attempts = $3, next_contact_on = $4::date,
            last_result = $5, outcome_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END,
            outcome_by = CASE WHEN $2::text IS NULL THEN NULL ELSE $6::int END
      WHERE assignment_id = $1`,
    [assignmentId, step.close, step.attempts, step.nextContactOn, outcome, userId])
}

// Asignaciones ya maduras (paso la ventana) por grupo y segmento. Compro = venta
// del ERP de CUALQUIER programa dentro de la ventana, registre o no el asesor el
// resultado (si marco "Lo pienso" y compro al dia 10, cuenta igual).
async function measurementRows (today, windowDays) {
  const { rows } = await pool.query(
    `SELECT a.is_control, a.level, a.probability::float AS probability, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM public.mv_commercial_history h
               WHERE h.phone_key = a.phone_key AND h.source = 'ERP_ENROLLMENT'
                 AND h.event_date BETWEEN a.assigned_on AND a.assigned_on + ($2::int - 1)))::int AS compraron
       FROM public.pred_call_assignments a
      WHERE a.assigned_on <= $1::date - $2::int
      GROUP BY 1, 2, 3`,
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
            COUNT(*) FILTER (WHERE NOT is_control AND EXISTS (
              SELECT 1 FROM public.pred_call_log l WHERE l.assignment_id = a.assignment_id))::int AS con_resultado,
            COUNT(*) FILTER (WHERE NOT is_control AND outcome = 'VENCIDO')::int AS vencidos
       FROM public.pred_call_assignments a`,
    [today, windowDays])
  return rows[0]
}

// Que dicen los clientes: cada resultado registrado (no solo el ultimo).
async function outcomesSince (since) {
  const { rows } = await pool.query(
    `SELECT outcome, COUNT(*)::int AS total
       FROM public.pred_call_log WHERE created_at >= $1::date
      GROUP BY 1 ORDER BY 2 DESC`,
    [since])
  return rows
}

// Para la ficha: cada llamada a ese numero, con quien y que dijo.
async function callLogOf (phoneKey) {
  const { rows } = await pool.query(
    `SELECT l.outcome, (l.created_at AT TIME ZONE 'America/Lima')::date::text AS fecha, u.name AS user_name, p.program_name
       FROM public.pred_call_log l
       JOIN public.pred_call_assignments a ON a.assignment_id = l.assignment_id
       LEFT JOIN public.users u ON u.user_id = l.user_id
       LEFT JOIN public.programs p ON p.program_id = a.program_id
      WHERE l.phone_key = $1
      ORDER BY l.created_at DESC
      LIMIT 20`,
    [phoneKey])
  return rows
}

export const bandejaRepository = {
  closePurchased, expireOverdue, candidates, advisorsWithLoad, insertAssignments, insertFollowups, cancelStaleFollowups,
  openAssignmentsOf, contactedOn, followupsDueOf, followupById, markFollowupDone, closedSince,
  assignmentById, logCall, applyStep, measurementRows, measurementStatus, outcomesSince, callLogOf
}
