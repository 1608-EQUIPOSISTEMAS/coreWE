import { pool } from '../../shared/db/pool.js'

// Persistencia de los eventos de Teams por sesion. Tabla lazy-create, mismo
// patron que edition_session_control. Una fila por (edicion, sesion): si la
// sesion se cancela y luego vuelve, la fila se reutiliza con el evento nuevo.
// start_at/end_at son hora local de Lima (sin zona), igual que el cronograma.
export class TeamsMeetingsRepository {
  constructor (db = pool) {
    this.db = db
    this._ready = false
  }

  async ensureTable () {
    if (this._ready) return
    await this.db.query(`
    CREATE TABLE IF NOT EXISTS public.edition_session_teams (
      id                  SERIAL PRIMARY KEY,
      program_edition_id  INTEGER NOT NULL,
      session_number      INTEGER NOT NULL CHECK (session_number > 0),
      organizer           TEXT NOT NULL,
      event_id            TEXT,
      join_url            TEXT,
      subject             TEXT,
      start_at            TIMESTAMP NOT NULL,
      end_at              TIMESTAMP NOT NULL,
      status              VARCHAR(10) NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'cancelled', 'error')),
      last_error          TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (program_edition_id, session_number)
    );
    CREATE INDEX IF NOT EXISTS idx_edition_session_teams_start
      ON public.edition_session_teams (start_at) WHERE status = 'active';
    -- Copia del link en Odoo (slide.session.meeting_url). odoo_url = lo que
    -- el ERP escribio por ultima vez: distinto de join_url = falta escribir.
    ALTER TABLE public.edition_session_teams
      ADD COLUMN IF NOT EXISTS odoo_session_id INTEGER,
      ADD COLUMN IF NOT EXISTS odoo_url        TEXT,
      ADD COLUMN IF NOT EXISTS odoo_error      TEXT,
      ADD COLUMN IF NOT EXISTS odoo_synced_at  TIMESTAMPTZ;
    -- Opciones aplicadas a la reunion de Teams (coorganizador, grabacion):
    -- firma de meetingOptions(); distinta de la deseada = falta aplicar.
    ALTER TABLE public.edition_session_teams
      ADD COLUMN IF NOT EXISTS online_meeting_id TEXT,
      ADD COLUMN IF NOT EXISTS meeting_options   TEXT,
      ADD COLUMN IF NOT EXISTS options_error     TEXT;
  `)
    this._ready = true
  }

  // Eventos activos (con link) de las ediciones pedidas.
  async listActive (editionIds) {
    await this.ensureTable()
    if (!editionIds.length) return []
    const { rows } = await this.db.query(`
    SELECT program_edition_id, session_number, organizer, event_id, join_url, subject,
           TO_CHAR(start_at, 'YYYY-MM-DD"T"HH24:MI') AS start_local,
           TO_CHAR(end_at,   'YYYY-MM-DD"T"HH24:MI') AS end_local
      FROM public.edition_session_teams
     WHERE program_edition_id = ANY($1::int[]) AND status = 'active'
  `, [editionIds])
    return rows
  }

  // Eventos activos futuros de ediciones que YA NO estan en la lista de
  // candidatas (desactivadas, A5, pasadas a presencial): hay que cancelarlos.
  async listOrphans (activeEditionIds, today) {
    await this.ensureTable()
    const { rows } = await this.db.query(`
    SELECT program_edition_id, session_number, organizer, event_id,
           TO_CHAR(start_at, 'YYYY-MM-DD"T"HH24:MI') AS start_local
      FROM public.edition_session_teams
     WHERE status = 'active'
       AND start_at::date >= $2::date
       AND NOT (program_edition_id = ANY($1::int[]))
  `, [activeEditionIds, today])
    return rows
  }

  async upsertActive ({ edition_id, session_number, organizer, event_id, join_url, subject, start_local, end_local }) {
    await this.db.query(`
    INSERT INTO public.edition_session_teams
      (program_edition_id, session_number, organizer, event_id, join_url, subject,
       start_at, end_at, status, last_error, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7::timestamp, $8::timestamp, 'active', NULL, NOW())
    ON CONFLICT (program_edition_id, session_number) DO UPDATE
       SET organizer = EXCLUDED.organizer, event_id = EXCLUDED.event_id,
           join_url = EXCLUDED.join_url, subject = EXCLUDED.subject,
           start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at,
           status = 'active', last_error = NULL, updated_at = NOW()
  `, [edition_id, session_number, organizer, event_id, join_url, subject, start_local, end_local])
  }

  async updateSlot ({ edition_id, session_number, subject, start_local, end_local }) {
    await this.db.query(`
    UPDATE public.edition_session_teams
       SET subject = $3, start_at = $4::timestamp, end_at = $5::timestamp,
           last_error = NULL, updated_at = NOW()
     WHERE program_edition_id = $1 AND session_number = $2
  `, [edition_id, session_number, subject, start_local, end_local])
  }

  async markCancelled (edition_id, session_number) {
    await this.db.query(`
    UPDATE public.edition_session_teams
       SET status = 'cancelled', updated_at = NOW()
     WHERE program_edition_id = $1 AND session_number = $2
  `, [edition_id, session_number])
  }

  // Un fallo de creacion deja rastro sin pisar un evento activo existente.
  async markError ({ edition_id, session_number, organizer, subject, start_local, end_local }, message) {
    await this.ensureTable()
    await this.db.query(`
    INSERT INTO public.edition_session_teams
      (program_edition_id, session_number, organizer, subject, start_at, end_at, status, last_error)
    VALUES ($1, $2, $3, $4, $5::timestamp, $6::timestamp, 'error', $7)
    ON CONFLICT (program_edition_id, session_number) DO UPDATE
       SET last_error = EXCLUDED.last_error, updated_at = NOW(),
           status = CASE WHEN edition_session_teams.status = 'active'
                         THEN 'active' ELSE 'error' END
  `, [edition_id, session_number, organizer || '-', subject, start_local, end_local, String(message).slice(0, 500)])
  }

  // Links activos de sesiones futuras: se contrastan con lo que Odoo tiene de
  // verdad (no solo con lo que el ERP escribio), porque al reprogramar en Odoo
  // pueden borrar/recrear sesiones o pisar el campo.
  async listOdooRows (editionIds, today) {
    await this.ensureTable()
    if (!editionIds.length) return []
    const { rows } = await this.db.query(`
    SELECT program_edition_id, session_number, join_url, odoo_url
      FROM public.edition_session_teams
     WHERE program_edition_id = ANY($1::int[])
       AND status = 'active' AND join_url IS NOT NULL
       AND start_at::date >= $2::date
  `, [editionIds, today])
    return rows
  }

  // Reuniones activas futuras con su firma de opciones aplicada.
  async listForOptions (editionIds, today) {
    await this.ensureTable()
    if (!editionIds.length) return []
    const { rows } = await this.db.query(`
    SELECT program_edition_id, session_number, organizer, join_url,
           online_meeting_id, meeting_options
      FROM public.edition_session_teams
     WHERE program_edition_id = ANY($1::int[])
       AND status = 'active' AND join_url IS NOT NULL
       AND start_at::date >= $2::date
  `, [editionIds, today])
    return rows
  }

  async markOptionsApplied (edition_id, session_number, meetingId, signature) {
    await this.db.query(`
    UPDATE public.edition_session_teams
       SET online_meeting_id = $3, meeting_options = $4, options_error = NULL, updated_at = NOW()
     WHERE program_edition_id = $1 AND session_number = $2
  `, [edition_id, session_number, meetingId, signature])
  }

  async markOptionsError (edition_id, session_number, message) {
    await this.db.query(`
    UPDATE public.edition_session_teams
       SET options_error = $3, updated_at = NOW()
     WHERE program_edition_id = $1 AND session_number = $2
  `, [edition_id, session_number, String(message).slice(0, 500)])
  }

  // Una sesion de Odoo donde el ERP ya escribio un link de esta aula: sirve
  // para encontrar su grupo si el nombre cambio (Producto movio el inicio).
  async odooSessionHint (editionId) {
    await this.ensureTable()
    const { rows } = await this.db.query(`
    SELECT odoo_session_id FROM public.edition_session_teams
     WHERE program_edition_id = $1 AND odoo_session_id IS NOT NULL
     ORDER BY odoo_synced_at DESC NULLS LAST LIMIT 1
  `, [editionId])
    return rows[0]?.odoo_session_id || null
  }

  // Canceladas cuyo link sigue escrito en Odoo: hay que retirarlo.
  async listOdooToClear () {
    await this.ensureTable()
    const { rows } = await this.db.query(`
    SELECT program_edition_id, session_number, odoo_session_id, odoo_url
      FROM public.edition_session_teams
     WHERE status = 'cancelled' AND odoo_url IS NOT NULL
  `)
    return rows
  }

  async markOdooSynced (edition_id, session_number, odooSessionId, url) {
    await this.db.query(`
    UPDATE public.edition_session_teams
       SET odoo_session_id = $3, odoo_url = $4, odoo_error = NULL, odoo_synced_at = NOW()
     WHERE program_edition_id = $1 AND session_number = $2
  `, [edition_id, session_number, odooSessionId, url])
  }

  async markOdooError (edition_id, session_number, message) {
    await this.db.query(`
    UPDATE public.edition_session_teams
       SET odoo_error = $3, odoo_synced_at = NOW()
     WHERE program_edition_id = $1 AND session_number = $2
  `, [edition_id, session_number, String(message).slice(0, 500)])
  }

  // Resumen para la pantalla: cuantas sesiones con link / con error.
  async summary (today) {
    await this.ensureTable()
    const { rows } = await this.db.query(`
    SELECT COUNT(*) FILTER (WHERE status = 'active' AND start_at::date >= $1::date)::int AS active_future,
           COUNT(*) FILTER (WHERE status = 'error')::int                                AS errors,
           COUNT(*) FILTER (WHERE status = 'active' AND odoo_error IS NOT NULL)::int     AS odoo_errors,
           COUNT(DISTINCT program_edition_id) FILTER (WHERE status = 'active')::int     AS editions,
           MAX(updated_at)                                                              AS last_sync_at
      FROM public.edition_session_teams
  `, [today])
    return rows[0]
  }

  async listErrors (limit = 50) {
    await this.ensureTable()
    const { rows } = await this.db.query(`
    SELECT program_edition_id, session_number, subject, last_error, odoo_error, updated_at
      FROM public.edition_session_teams
     WHERE last_error IS NOT NULL OR odoo_error IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT $1
  `, [limit])
    return rows
  }
}

export const teamsMeetingsRepository = new TeamsMeetingsRepository()
