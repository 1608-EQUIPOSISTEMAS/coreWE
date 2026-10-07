import { pool } from '../../../shared/db/pool.js'

export async function fetchNote (ticketId, db = pool) {
  const { rows } = await db.query(`
    SELECT ticket_id, fingerprint, payload, model,
           -- generated_at es la hora local de la sesion (LOCALTIMESTAMP), y la
           -- BD corre en UTC: se pasa a Lima o "Generado el" salia 5 h adelantado.
           to_char((generated_at AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'America/Lima',
                   'YYYY-MM-DD HH24:MI') AS generated_at
      FROM public.ai_ticket_notes WHERE ticket_id = $1`, [ticketId])
  return rows[0] ?? null
}

export async function saveNote ({ ticketId, fingerprint, payload, model }, db = pool) {
  await db.query(`
    INSERT INTO public.ai_ticket_notes (ticket_id, fingerprint, payload, model, generated_at)
    VALUES ($1, $2, $3, $4, LOCALTIMESTAMP)
    ON CONFLICT (ticket_id)
    DO UPDATE SET fingerprint = EXCLUDED.fingerprint, payload = EXCLUDED.payload,
                  model = EXCLUDED.model, generated_at = EXCLUDED.generated_at`,
  [ticketId, fingerprint, JSON.stringify(payload), model])
}
