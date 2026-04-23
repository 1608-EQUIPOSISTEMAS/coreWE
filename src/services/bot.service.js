import { pool } from '../config/db.js'
import { callProcedureReturningRows } from '../utils/spHelper.js'

/**
 * LISTAR TICKETS
 * Retorna la data cruda del SP con paginación.
 */
async function botTicketList (payload = {}) {
  const { page = 1, size = 25 } = payload

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_bot_ticket_list',
    [JSON.stringify(payload)], // Pasamos todo el payload como JSONB
    { statementTimeoutMs: 25000 }
  )

  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0

  return { 
    total, 
    page: Number(page), 
    size: Number(size), 
    items: rows 
  }
}
/**
 * OBTENER MÉTRICAS DEL DASHBOARD DEL BOT
 */
async function botDashboardMetricsGet(payload = {}) {
  // Aseguramos que solo pasen los filtros de fecha
  const filters = {
    from_date: payload.from_date || null,
    to_date: payload.to_date || null
  }

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_bot_dashboard_metrics_get',
    [JSON.stringify(filters)],
    { statementTimeoutMs: 25000 }
  )

  // Retornamos el primer row tal cual viene del SP (ya trae los JSONB de gráficos)
  return {
    data: rows?.[0] || {} 
  }
}
/**
 * OBTENER DETALLE DE TICKET
 * Retorna la data cruda (raw) del SP.
 */
async function botTicketGet ({ id }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_bot_ticket_get',
    [id],
    { statementTimeoutMs: 25000 }
  )

  return {
    data: rows?.[0] || {} 
  }
}
/**
 * ACTUALIZAR TICKET (Estado, notas, agente)
 */
async function botTicketUpdate ({ id, status, notes, assigned_to, user_id, current_user_id }) {
  const payload = {
    status,
    notes,
    assigned_to: assigned_to ?? null,
    resolved_by: current_user_id ?? user_id ?? null
  }

  const query = 'CALL public.sp_bot_ticket_update($1, $2::jsonb)';
  const values = [id, JSON.stringify(payload)];

  await pool.query(query, values);

  return { success: true, ticket_id: id }
}
async function botStudentList(payload = {}) {
  const { page = 1, size = 25 } = payload

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_bot_student_list',
    [JSON.stringify(payload)],
    { statementTimeoutMs: 25000 }
  )

  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0

  return { total, page: Number(page), size: Number(size), items: rows }
}

async function botStudentGet({ id }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_bot_student_get',
    [id],
    { statementTimeoutMs: 25000 }
  )

  return { data: rows?.[0] || {} }
}

async function botCsatList(payload = {}) {
  const { page = 1, size = 25 } = payload

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_bot_csat_list',
    [JSON.stringify(payload)],
    { statementTimeoutMs: 25000 }
  )

  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0
  return { total, page: Number(page), size: Number(size), items: rows }
}

/**
 * LISTA DE ASESORES (para asignación de tickets)
 * Devuelve usuarios con rol ACADEMICA habilitados.
 */
async function botAdvisorList() {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_bot_advisor_list',
    [],
    { statementTimeoutMs: 15000 }
  )
  return { items: rows }
}

export default {
  botTicketList,
  botTicketGet,
  botTicketUpdate,
  botDashboardMetricsGet,
  botStudentList,
  botStudentGet,
  botCsatList,
  botAdvisorList
}