import { pool } from '../../../shared/db/pool.js'
import { EXCLUDED_STATUSES, ATTEMPT_PENDING_RESULT, LOOKBACK_DAYS } from './daily-plan.entity.js'

// Clave del advisory lock: una sola generacion a la vez en TODA la BD. El cron
// puede correr en mas de un proceso (produccion y un backend local por tunel);
// el lock hace que el segundo simplemente no haga nada.
const LOCK_KEY = 'ai_daily_plan'

// Asesores del area: rol del area a secas (no el LIDER_). Mismo criterio que
// TEAM_SCOPE_SQL: usuario activo con ese rol.
export async function fetchAdvisors (areaRole, db = pool) {
  const { rows } = await db.query(`
    SELECT u.user_id, u.name
      FROM public.users u
     WHERE u.active = 'Y'
       AND EXISTS (SELECT 1 FROM public.user_roles ur
                     JOIN public.rol r ON r.rol_id = ur.rol_id
                    WHERE ur.user_id = u.user_id AND r.alias = $1)
     ORDER BY u.name`, [areaRole])
  return rows
}

// Consultas abiertas de los asesores con lo necesario para priorizarlas: el
// ultimo intento CON resultado y la llamada agendada para hoy si la hay. El
// filtro fino (reglas) lo hace la entity; aqui solo se acota el universo.
export async function fetchCandidateLeads (userIds, db = pool) {
  if (!userIds.length) return []
  const { rows } = await db.query(`
    WITH base AS (
      SELECT l.lead_id, l.user_registration_id AS user_id, l.full_name, l.registration_date,
             l.cat_status_lead, l.cat_interest_level, l.origin_phone,
             cc.variable_2 AS country_code,
             p.program_name AS programa
        FROM public.leads l
        LEFT JOIN public.catalog cc ON cc.catalog_id = l.cat_code_country
        LEFT JOIN public.program_versions pv ON pv.program_version_id = l.program_version_id
        LEFT JOIN public.programs p ON p.program_id = pv.program_id
       WHERE l.active = 'Y'
         AND l.user_registration_id = ANY($1::int[])
         AND l.cat_status_lead <> ALL($2::int[])
         AND l.registration_date >= LOCALTIMESTAMP - make_interval(days => $4::int)
    ),
    ultimo AS (
      SELECT DISTINCT ON (a.lead_id) a.lead_id, a.cat_result, c.description AS label, a.contact_datetime
        FROM public.lead_contact_attempts a
        JOIN public.catalog c ON c.catalog_id = a.cat_result
       WHERE a.lead_id IN (SELECT lead_id FROM base)
         AND a.cat_result <> $3::int
       ORDER BY a.lead_id, a.contact_datetime DESC
    ),
    agenda AS (
      SELECT a.lead_id, to_char(MIN(a.contact_datetime), 'HH24:MI') AS hora
        FROM public.lead_contact_attempts a
       WHERE a.lead_id IN (SELECT lead_id FROM base)
         AND a.cat_result = $3::int
         AND a.contact_datetime::date = CURRENT_DATE
       GROUP BY a.lead_id
    )
    SELECT b.*, u.cat_result AS ult_result, u.label AS ult_result_label,
           u.contact_datetime AS ult_fecha, g.hora AS agenda_hora
      FROM base b
      LEFT JOIN ultimo u ON u.lead_id = b.lead_id
      LEFT JOIN agenda g ON g.lead_id = b.lead_id`,
  [userIds, EXCLUDED_STATUSES, ATTEMPT_PENDING_RESULT, LOOKBACK_DAYS])
  return rows
}

// Upsert: regenerar el mismo dia reemplaza la fila.
export async function savePlan ({ planDate, area, userId = null, payload, model }, db = pool) {
  await db.query(`
    INSERT INTO public.ai_daily_plans (plan_date, area, user_id, payload, model, generated_at)
    VALUES ($1, $2, $3, $4, $5, LOCALTIMESTAMP)
    ON CONFLICT (plan_date, area, COALESCE(user_id, 0))
    DO UPDATE SET payload = EXCLUDED.payload, model = EXCLUDED.model, generated_at = EXCLUDED.generated_at`,
  [planDate, area, userId, JSON.stringify(payload), model])
}

// Filas del plan mas reciente del area (hoy, o el ultimo dia generado si hoy
// aun no corre). userId null = todas las del area (vista del lider).
export async function fetchLatestPlans ({ area, userId = null }, db = pool) {
  const { rows } = await db.query(`
    SELECT p.plan_date::text AS plan_date, p.user_id, u.name, p.payload,
           to_char(p.generated_at, 'YYYY-MM-DD HH24:MI') AS generated_at
      FROM public.ai_daily_plans p
      LEFT JOIN public.users u ON u.user_id = p.user_id
     WHERE p.area = $1
       AND p.plan_date = (SELECT MAX(plan_date) FROM public.ai_daily_plans
                           WHERE area = $1 AND plan_date <= CURRENT_DATE)
       AND ($2::int IS NULL OR p.user_id = $2 OR p.user_id IS NULL)
     ORDER BY u.name NULLS FIRST`, [area, userId])
  return rows
}

export async function hasPlanForToday (area, db = pool) {
  const { rows } = await db.query(
    'SELECT 1 FROM public.ai_daily_plans WHERE area = $1 AND plan_date = CURRENT_DATE LIMIT 1', [area])
  return rows.length > 0
}

// Ejecuta fn con el advisory lock tomado en una conexion dedicada. Si otro
// proceso ya lo tiene, devuelve { skipped: true } sin esperar.
export async function withGenerationLock (fn, db = pool) {
  const client = await db.connect()
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [LOCK_KEY])
    if (!rows[0].ok) return { skipped: true }
    try {
      return await fn()
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY])
    }
  } finally {
    client.release()
  }
}

export async function currentDate (db = pool) {
  const { rows } = await db.query('SELECT CURRENT_DATE::text AS hoy')
  return rows[0].hoy
}
