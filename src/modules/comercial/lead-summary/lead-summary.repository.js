import { pool } from '../../../shared/db/pool.js'

// Datos del lead que entran al resumen: lo que el asesor ve en la ficha.
export async function fetchLead (leadId, db = pool) {
  const { rows } = await db.query(`
    SELECT l.lead_id, l.full_name, l.registration_date, l.observations,
           st.description AS estado, it.description AS interes,
           p.program_name AS programa
      FROM public.leads l
      LEFT JOIN public.catalog st ON st.catalog_id = l.cat_status_lead
      LEFT JOIN public.catalog it ON it.catalog_id = l.cat_interest_level
      LEFT JOIN public.program_versions pv ON pv.program_version_id = l.program_version_id
      LEFT JOIN public.programs p ON p.program_id = pv.program_id
     WHERE l.lead_id = $1 AND l.active = 'Y'`, [leadId])
  return rows[0] ?? null
}

export async function fetchAttempts (leadId, db = pool) {
  const { rows } = await db.query(`
    SELECT a.lead_contact_attempt_id, a.contact_datetime, a.contact_duration, a.response,
           tp.description AS tipo, rs.description AS resultado,
           COALESCE(a.modification_date, a.registration_date)::text AS modificado
      FROM public.lead_contact_attempts a
      LEFT JOIN public.catalog tp ON tp.catalog_id = a.cat_type_attempt
      LEFT JOIN public.catalog rs ON rs.catalog_id = a.cat_result
     WHERE a.lead_id = $1
     ORDER BY a.contact_datetime`, [leadId])
  return rows
}

export async function fetchSummary (leadId, db = pool) {
  const { rows } = await db.query(`
    SELECT lead_id, fingerprint, payload, model,
           to_char(generated_at, 'YYYY-MM-DD HH24:MI') AS generated_at
      FROM public.ai_lead_summaries WHERE lead_id = $1`, [leadId])
  return rows[0] ?? null
}

export async function saveSummary ({ leadId, fingerprint, payload, model }, db = pool) {
  await db.query(`
    INSERT INTO public.ai_lead_summaries (lead_id, fingerprint, payload, model, generated_at)
    VALUES ($1, $2, $3, $4, LOCALTIMESTAMP)
    ON CONFLICT (lead_id)
    DO UPDATE SET fingerprint = EXCLUDED.fingerprint, payload = EXCLUDED.payload,
                  model = EXCLUDED.model, generated_at = EXCLUDED.generated_at`,
  [leadId, fingerprint, JSON.stringify(payload), model])
}

// Candidatos del pre-calentado nocturno: leads abiertos con algun intento
// registrado AYER (lo que el asesor va a retomar hoy) cuyo resumen no existe o
// quedo viejo. Los mas movidos primero.
export async function fetchPrewarmCandidates (limit, db = pool) {
  const { rows } = await db.query(`
    SELECT a.lead_id
      FROM public.lead_contact_attempts a
      JOIN public.leads l ON l.lead_id = a.lead_id AND l.active = 'Y'
      LEFT JOIN public.ai_lead_summaries s ON s.lead_id = a.lead_id
     WHERE a.contact_datetime >= CURRENT_DATE - 1
       AND a.contact_datetime <  CURRENT_DATE
       AND (s.lead_id IS NULL OR s.generated_at < a.contact_datetime)
     GROUP BY a.lead_id
     ORDER BY COUNT(*) DESC, a.lead_id DESC
     LIMIT $1`, [limit])
  return rows.map(r => r.lead_id)
}
