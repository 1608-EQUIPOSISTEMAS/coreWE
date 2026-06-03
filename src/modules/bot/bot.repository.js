import { pool } from '../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../shared/db/sp.js'

// Persistencia del dominio bot. Envuelve los stored procedures sp_bot_*.
export class BotRepository {
  constructor (db = pool, sp = callProcedureReturningRows) {
    this.db = db
    this.sp = sp
  }

  async ticketList (payload) {
    return this.sp(
      this.db,
      'public.sp_bot_ticket_list',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 25000 }
    )
  }

  async ticketGet (id) {
    return this.sp(
      this.db,
      'public.sp_bot_ticket_get',
      [id],
      { statementTimeoutMs: 25000 }
    )
  }

  async ticketUpdate (id, payload) {
    const query = 'CALL public.sp_bot_ticket_update($1, $2::jsonb)';
    const values = [id, JSON.stringify(payload)];

    await this.db.query(query, values);
  }

  async dashboardMetricsGet (filters) {
    return this.sp(
      this.db,
      'public.sp_bot_dashboard_metrics_get',
      [JSON.stringify(filters)],
      { statementTimeoutMs: 25000 }
    )
  }

  async studentList (payload) {
    return this.sp(
      this.db,
      'public.sp_bot_student_list',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 25000 }
    )
  }

  async studentGet (id) {
    return this.sp(
      this.db,
      'public.sp_bot_student_get',
      [id],
      { statementTimeoutMs: 25000 }
    )
  }

  async csatList (payload) {
    return this.sp(
      this.db,
      'public.sp_bot_csat_list',
      [JSON.stringify(payload)],
      { statementTimeoutMs: 25000 }
    )
  }

  async advisorList () {
    const { rows } = await this.db.query('SELECT * FROM public.sp_bot_advisor_list()')
    return rows
  }
}

export const botRepository = new BotRepository()
