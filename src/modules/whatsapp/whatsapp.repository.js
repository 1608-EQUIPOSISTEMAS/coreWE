import { pool } from '../../shared/db/pool.js'

// Persistencia del bot de WhatsApp (scripts/wa-01-ddl.sql). SQL directo: son
// upserts simples, sin regla de negocio que justifique un SP.

// Con quién habla la conversación y a quién se deriva: la asesora del programa
// o, si el programa no tiene, la línea marcada como asesora por defecto.
const CONVERSATION_SELECT = `
  SELECT c.*, n.phone_number_id, n.label AS number_label, n.role AS number_role, n.user_id AS number_user_id,
         adv.label AS advisor_label, adv.user_id AS advisor_user_id, p.program_name
    FROM public.wa_conversations c
    JOIN public.wa_numbers n ON n.wa_number_id = c.wa_number_id
    LEFT JOIN public.wa_numbers adv ON adv.wa_number_id = c.advisor_number_id
    LEFT JOIN public.programs p ON p.program_id = c.program_id`

export class WhatsappRepository {
  constructor (db = pool) {
    this.db = db
  }

  async findActiveNumber (phoneNumberId) {
    const { rows } = await this.db.query(
      `SELECT wa_number_id, role FROM public.wa_numbers
        WHERE phone_number_id = $1 AND active = 'Y'`, [phoneNumberId])
    return rows[0] ?? null
  }

  async listProgramPrefills () {
    const { rows } = await this.db.query(
      'SELECT program_id, prefill_phrases FROM public.wa_program_advisors')
    return rows
  }

  // El origen, el programa y el referral se fijan con el PRIMER mensaje; los
  // siguientes solo actualizan el nombre y el último mensaje del lead.
  // ponytail: un lead que vuelve por otro anuncio conserva el primer origen; reabrir la conversación cuando Marketing mida por campaña.
  async upsertConversation ({ waNumberId, contactPhone, contactName, programId, source, referral, leadMessageAt, status }) {
    const { rows } = await this.db.query(
      `INSERT INTO public.wa_conversations
              (wa_number_id, contact_phone, contact_name, program_id, source, referral, last_lead_message_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (wa_number_id, contact_phone) DO UPDATE
          SET contact_name = COALESCE(EXCLUDED.contact_name, wa_conversations.contact_name),
              program_id = COALESCE(wa_conversations.program_id, EXCLUDED.program_id),
              last_lead_message_at = GREATEST(wa_conversations.last_lead_message_at, EXCLUDED.last_lead_message_at)
       RETURNING *`,
      [waNumberId, contactPhone, contactName, programId, source, referral, leadMessageAt, status])
    return rows[0]
  }

  // null si el wamid ya estaba: Meta reintentó el webhook.
  async insertIncomingMessage ({ conversationId, wamid, type, body, payload }) {
    const { rows } = await this.db.query(
      `INSERT INTO public.wa_messages (conversation_id, wamid, direction, type, body, payload)
       VALUES ($1, $2, 'IN', $3, $4, $5)
       ON CONFLICT (wamid) DO NOTHING
       RETURNING message_id`,
      [conversationId, wamid, type, body, payload])
    return rows[0] ?? null
  }

  // Atómico: si dos mensajes del lead llegan juntos, solo uno gana y el bot
  // no manda la biblioteca dos veces. false = otro webhook ya la reclamó.
  async claimFirstReply (conversationId) {
    const { rowCount } = await this.db.query(
      `UPDATE public.wa_conversations SET window_opened_at = now()
        WHERE conversation_id = $1 AND window_opened_at IS NULL`, [conversationId])
    return rowCount === 1
  }

  async releaseFirstReply (conversationId) {
    await this.db.query(
      'UPDATE public.wa_conversations SET window_opened_at = NULL WHERE conversation_id = $1', [conversationId])
  }

  async insertOutgoingMessage ({ conversationId, wamid, type, body, sentBy, userId = null, payload = null }) {
    const { rows } = await this.db.query(
      `INSERT INTO public.wa_messages (conversation_id, wamid, direction, type, body, sent_by, user_id, delivery_status, payload)
       VALUES ($1, $2, 'OUT', $3, $4, $5, $6, 'accepted', $7)
       RETURNING message_id, direction, type, body, sent_by, delivery_status, registration_date`,
      [conversationId, wamid, type, body, sentBy, userId, payload])
    return rows[0]
  }

  // `errors` solo viene en 'failed' (el porqué de Meta); se guarda en el payload
  // del saliente para que la bandeja lo muestre sin abrir logs.
  async updateDeliveryStatus ({ wamid, status, errors }) {
    await this.db.query(
      `UPDATE public.wa_messages
          SET delivery_status = $2,
              payload = CASE WHEN $3::jsonb IS NULL THEN payload ELSE COALESCE(payload, '{}'::jsonb) || jsonb_build_object('errors', $3::jsonb) END
        WHERE wamid = $1`, [wamid, status, errors ? JSON.stringify(errors) : null])
  }

  // ── Derivación (hora 71) ─────────────────────────────────────────────────
  // Usa el índice parcial wa_conversations_handoff_due_ix.
  async listDueHandoffs (cutoff) {
    const { rows } = await this.db.query(
      `SELECT conversation_id FROM public.wa_conversations
        WHERE status = 'BOT' AND handoff_sent_at IS NULL AND window_opened_at <= $1
        ORDER BY window_opened_at
        LIMIT 50`, [cutoff])
    return rows.map(r => r.conversation_id)
  }

  // Reclama la derivación (atómico, como claimFirstReply) y fija a la asesora.
  // null = otro proceso ya la derivó o no hay asesora configurada.
  async claimHandoff (conversationId) {
    const { rows } = await this.db.query(
      `WITH advisor AS (
         SELECT COALESCE(
                  (SELECT pa.advisor_number_id FROM public.wa_program_advisors pa
                     JOIN public.wa_numbers n ON n.wa_number_id = pa.advisor_number_id AND n.active = 'Y'
                    WHERE pa.program_id = c.program_id),
                  (SELECT wa_number_id FROM public.wa_numbers WHERE is_default_advisor AND active = 'Y')
                ) AS id
           FROM public.wa_conversations c WHERE c.conversation_id = $1)
       UPDATE public.wa_conversations c
          SET status = 'HANDED_OFF', handoff_sent_at = now(), advisor_number_id = advisor.id
         FROM advisor
        WHERE c.conversation_id = $1 AND c.handoff_sent_at IS NULL AND advisor.id IS NOT NULL
       RETURNING c.conversation_id`, [conversationId])
    return rows.length ? this.findConversation(conversationId) : null
  }

  async releaseHandoff (conversationId) {
    await this.db.query(
      `UPDATE public.wa_conversations SET status = 'BOT', handoff_sent_at = NULL, advisor_number_id = NULL
        WHERE conversation_id = $1`, [conversationId])
  }

  async findAdvisorPhone (waNumberId) {
    const { rows } = await this.db.query(
      'SELECT display_phone FROM public.wa_numbers WHERE wa_number_id = $1', [waNumberId])
    return rows[0]?.display_phone ?? null
  }

  // Regla B: una sola respuesta tras derivar. false = ya se mandó.
  async claimPostHandoffReply (conversationId) {
    const { rowCount } = await this.db.query(
      `UPDATE public.wa_conversations SET post_handoff_reply_at = now()
        WHERE conversation_id = $1 AND post_handoff_reply_at IS NULL`, [conversationId])
    return rowCount === 1
  }

  async releasePostHandoffReply (conversationId) {
    await this.db.query(
      'UPDATE public.wa_conversations SET post_handoff_reply_at = NULL WHERE conversation_id = $1', [conversationId])
  }

  // ── Bandeja del ERP ──────────────────────────────────────────────────────
  async findConversation (conversationId) {
    const { rows } = await this.db.query(`${CONVERSATION_SELECT} WHERE c.conversation_id = $1`, [conversationId])
    return rows[0] ?? null
  }

  // userId NULL = líder (todas). Si no, las de su línea o las que le derivaron.
  // ponytail: tope de 200 recientes sin paginar; paginar cuando el bot tenga volumen real.
  async listConversations ({ userId, status }) {
    const { rows } = await this.db.query(
      `SELECT x.*, last.body AS last_body, last.direction AS last_direction, last.registration_date AS last_at
         FROM (${CONVERSATION_SELECT}) x
         LEFT JOIN LATERAL (
           SELECT body, direction, registration_date FROM public.wa_messages m
            WHERE m.conversation_id = x.conversation_id ORDER BY m.message_id DESC LIMIT 1
         ) last ON true
        WHERE ($1::int IS NULL OR x.number_user_id = $1 OR x.advisor_user_id = $1)
          AND ($2::text IS NULL OR x.status = $2)
        ORDER BY COALESCE(last.registration_date, x.registration_date) DESC
        LIMIT 200`, [userId, status])
    return rows
  }

  async listMessages (conversationId) {
    const { rows } = await this.db.query(
      `SELECT m.message_id, m.direction, m.type, m.body, m.sent_by, m.delivery_status,
              m.payload -> 'errors' AS errors, m.registration_date, u.alias AS user_alias
         FROM public.wa_messages m
         LEFT JOIN public.users u ON u.user_id = m.user_id
        WHERE m.conversation_id = $1
        ORDER BY m.message_id`, [conversationId])
    return rows
  }

  // ── Configuración ────────────────────────────────────────────────────────
  async listNumbers () {
    const { rows } = await this.db.query(
      `SELECT n.wa_number_id, n.phone_number_id, n.display_phone, n.label, n.role, n.user_id,
              u.alias AS user_alias, n.is_default_advisor, n.active
         FROM public.wa_numbers n LEFT JOIN public.users u ON u.user_id = n.user_id
        ORDER BY n.role DESC, n.label`)
    return rows
  }

  // Una sola línea por defecto (índice único parcial): se apaga la anterior en la misma transacción.
  async saveNumber ({ waNumberId, phoneNumberId, displayPhone, label, role, userId, isDefaultAdvisor, active }) {
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      if (isDefaultAdvisor) {
        await client.query(
          'UPDATE public.wa_numbers SET is_default_advisor = false WHERE is_default_advisor AND wa_number_id IS DISTINCT FROM $1', [waNumberId ?? null])
      }
      const params = [phoneNumberId, displayPhone, label, role, userId, isDefaultAdvisor, active]
      const { rows } = waNumberId
        ? await client.query(
          `UPDATE public.wa_numbers
              SET phone_number_id = $1, display_phone = $2, label = $3, role = $4, user_id = $5, is_default_advisor = $6, active = $7
            WHERE wa_number_id = $8 RETURNING wa_number_id`, [...params, waNumberId])
        : await client.query(
          `INSERT INTO public.wa_numbers (phone_number_id, display_phone, label, role, user_id, is_default_advisor, active)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING wa_number_id`, params)
      await client.query('COMMIT')
      return rows[0] ?? null
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async listProgramAdvisors () {
    const { rows } = await this.db.query(
      `SELECT pa.program_id, p.program_name, pa.advisor_number_id, n.label AS advisor_label, pa.prefill_phrases
         FROM public.wa_program_advisors pa
         JOIN public.programs p ON p.program_id = pa.program_id
         JOIN public.wa_numbers n ON n.wa_number_id = pa.advisor_number_id
        ORDER BY p.program_name`)
    return rows
  }

  async saveProgramAdvisor ({ programId, advisorNumberId, prefillPhrases, userId }) {
    await this.db.query(
      `INSERT INTO public.wa_program_advisors (program_id, advisor_number_id, prefill_phrases, user_registration_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (program_id) DO UPDATE
          SET advisor_number_id = EXCLUDED.advisor_number_id, prefill_phrases = EXCLUDED.prefill_phrases,
              user_modification_id = $4, modification_date = now()`,
      [programId, advisorNumberId, prefillPhrases, userId])
  }

  async deleteProgramAdvisor (programId) {
    await this.db.query('DELETE FROM public.wa_program_advisors WHERE program_id = $1', [programId])
  }

  async listActivePrograms () {
    const { rows } = await this.db.query(
      `SELECT program_id, program_name FROM public.programs WHERE active = 'Y' ORDER BY program_name`)
    return rows
  }

  async listAdvisorUsers () {
    const { rows } = await this.db.query(
      `SELECT DISTINCT u.user_id, u.alias
         FROM public.users u
         JOIN public.user_roles ur ON ur.user_id = u.user_id
         JOIN public.rol r ON r.rol_id = ur.rol_id
        WHERE u.active = 'Y' AND r.alias IN ('COMERCIAL', 'LIDER_COMERCIAL')
        ORDER BY u.alias`)
    return rows
  }
}

export const whatsappRepository = new WhatsappRepository()
