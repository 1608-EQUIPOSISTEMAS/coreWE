import { pool, withTransaction } from '../../shared/db/pool.js'

// Unico que habla con la BD. SQL plano (sin SPs): las cinco tablas de tickets
// son nuevas y su DDL vive versionado en scripts/ddl-tickets.sql, mismo criterio
// que reprogram_cases y las tablas de Configuracion.

// Alcance de lectura, derivando el area del CREADOR del ticket.
//   $1 = areaRoles (text[] | null), $2 = userId (int | null)
//   null / null = sin filtro (ADMIN y GERENCIA).
//
// Se filtra por el rol del creador y no por una tabla de miembros del area:
// asi un ticket abierto por alguien que ya se fue de la empresa no desaparece
// del historial de su lider.
const SCOPE_SQL = `
  ($1::text[] IS NULL AND $2::int IS NULL)
  OR ($2::int IS NOT NULL AND t.created_by_id = $2)
  OR ($1::text[] IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.user_roles ur
          JOIN public.rol r ON r.rol_id = ur.rol_id
         WHERE ur.user_id = t.created_by_id AND r.alias = ANY($1)))`

// Columnas del ticket + las personas + los roles del creador (que son los que
// deciden el area) + los contadores de la fila del listado.
const TICKET_SELECT = `
  t.*,
  cu.name  AS creador,
  cu.alias AS creador_alias,
  cu.email AS creador_email,
  au.name  AS asignado,
  au.alias AS asignado_alias,
  COALESCE((SELECT array_agg(DISTINCT r.alias)
              FROM public.user_roles ur
              JOIN public.rol r ON r.rol_id = ur.rol_id
             WHERE ur.user_id = t.created_by_id), '{}')::text[] AS creador_roles,
  (SELECT COUNT(*)::int FROM public.ticket_comments c
    WHERE c.ticket_id = t.ticket_id AND c.active = 'Y') AS comentarios,
  (SELECT COUNT(*)::int FROM public.ticket_attachments a
    WHERE a.ticket_id = t.ticket_id AND a.active = 'Y') AS adjuntos`

const TICKET_JOINS = `
  FROM public.tickets t
  JOIN public.users cu ON cu.user_id = t.created_by_id
  LEFT JOIN public.users au ON au.user_id = t.assigned_to_id`

// Un agente es un usuario ADMIN activo. No se consulta por nombre de rol
// hardcodeado en varios lados: este es el unico lugar que lo sabe.
const AGENTES_SQL = `
  SELECT DISTINCT u.user_id, u.name
    FROM public.users u
    JOIN public.user_roles ur ON ur.user_id = u.user_id
    JOIN public.rol r ON r.rol_id = ur.rol_id
   WHERE u.active = 'Y' AND r.alias = 'ADMIN'`

export class TicketsRepository {
  constructor (db = pool) {
    this.db = db
  }

  // Bandeja. El filtro y los KPIs se resuelven en la entity sobre este
  // resultado: POR_VENCER depende del umbral del SLA y duplicarlo en SQL
  // desincronizaria la regla el dia que alguien lo mueva.
  //
  // LIMIT 500 alcanza de sobra para soporte interno (decenas de tickets al mes)
  // y evita traer el historico completo a memoria el ano que viene.
  async list ({ areaRoles = null, userId = null }, { busqueda = null, orden = 'sla' } = {}) {
    const { rows } = await this.db.query(`
      SELECT ${TICKET_SELECT}
      ${TICKET_JOINS}
       WHERE t.active = 'Y'
         AND (${SCOPE_SQL})
         AND ($3::text IS NULL
              OR t.title ILIKE '%' || $3 || '%'
              OR t.problem ILIKE '%' || $3 || '%'
              OR cu.name ILIKE '%' || $3 || '%')
       ORDER BY
         CASE WHEN $4 = 'sla' THEN LEAST(
           COALESCE(t.first_response_due_at, 'infinity'::timestamptz),
           COALESCE(t.resolution_due_at,     'infinity'::timestamptz)) END ASC NULLS LAST,
         t.ticket_id DESC
       LIMIT 500`, [areaRoles, userId, busqueda || null, orden])
    return rows
  }

  /** Los adjuntos del ticket. El listado solo lleva el conteo; el detalle, la lista. */
  async attachmentsOf (ticketId) {
    const { rows } = await this.db.query(`
      SELECT a.ticket_attachment_id AS id, a.original_name AS nombre,
             a.mime_type AS mime, a.size_bytes AS bytes
        FROM public.ticket_attachments a
       WHERE a.ticket_id = $1 AND a.active = 'Y'
       ORDER BY a.ticket_attachment_id`, [ticketId])
    return rows
  }

  async detail (ticketId, { areaRoles = null, userId = null } = {}) {
    // El alcance no se aplica aca sino en la entity (assertCanRead): un 403 y
    // un 404 son respuestas distintas y el usuario merece la correcta.
    const { rows } = await this.db.query(`
      SELECT ${TICKET_SELECT}
      ${TICKET_JOINS}
       WHERE t.ticket_id = $1 AND t.active = 'Y'`, [ticketId])
    return rows[0] ?? null
  }

  /**
   * Candidatos al reparto, con lo que la entity necesita para ordenarlos.
   * carga_activa y en_progreso miran solo tickets vivos; ultimo_asignado mira
   * TODOS (tambien los cerrados), porque el desempate pregunta cuando fue la
   * ultima vez que esa persona recibio trabajo, no cuanto tiene abierto.
   */
  async agentCandidates () {
    const { rows } = await this.db.query(`
      WITH agentes AS (${AGENTES_SQL})
      SELECT a.user_id,
             a.name,
             COUNT(t.ticket_id) FILTER (
               WHERE t.status IN ('ABIERTO','EN_PROGRESO') AND t.active = 'Y')::int AS carga_activa,
             COALESCE(BOOL_OR(t.status = 'EN_PROGRESO' AND t.active = 'Y'), false)  AS en_progreso,
             MAX(t.registration_date)                                               AS ultimo_asignado
        FROM agentes a
        LEFT JOIN public.tickets t ON t.assigned_to_id = a.user_id
       GROUP BY a.user_id, a.name
       ORDER BY a.name`)
    return rows
  }

  /** Lista para el selector de reasignacion. */
  async assignables () {
    const { rows } = await this.db.query(`${AGENTES_SQL} ORDER BY u.name`)
    return rows
  }

  /** El destino de una reasignacion, con lo que assertReassignable necesita. */
  async assignableById (userId) {
    const { rows } = await this.db.query(`
      SELECT u.user_id, u.name, u.active,
             EXISTS (SELECT 1 FROM public.user_roles ur
                       JOIN public.rol r ON r.rol_id = ur.rol_id
                      WHERE ur.user_id = u.user_id AND r.alias = 'ADMIN') AS es_agente,
             (SELECT COUNT(*)::int FROM public.tickets t
               WHERE t.assigned_to_id = u.user_id
                 AND t.status IN ('ABIERTO','EN_PROGRESO') AND t.active = 'Y') AS carga_activa
        FROM public.users u
       WHERE u.user_id = $1`, [userId])
    return rows[0] ?? null
  }

  /** Ticket + adjuntos en una transaccion: o entra todo, o no entra nada. */
  async create (ticket, archivos = []) {
    return withTransaction(async (client) => {
      const { rows } = await client.query(`
        INSERT INTO public.tickets (
          title, problem, link, priority, created_by_id, assigned_to_id,
          registration_date, first_response_due_at, resolution_due_at,
          slack_channel_id, slack_message_ts, user_registration_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$5)
        RETURNING ticket_id`, [
        ticket.title, ticket.problem, ticket.link, ticket.priority,
        ticket.created_by_id, ticket.assigned_to_id, ticket.registration_date,
        ticket.first_response_due_at, ticket.resolution_due_at,
        ticket.slack_channel_id ?? null, ticket.slack_message_ts ?? null
      ])
      const ticketId = rows[0].ticket_id

      for (const a of archivos) {
        await client.query(`
          INSERT INTO public.ticket_attachments (
            ticket_id, original_name, stored_name, mime_type, size_bytes, user_registration_id)
          VALUES ($1,$2,$3,$4,$5,$6)`,
        [ticketId, a.original_name, a.stored_name, a.mime_type, a.size_bytes, ticket.created_by_id])
      }

      return ticketId
    })
  }

  // SET directo, sin COALESCE: nextStatus ya manda el valor final de
  // resolved_at en los tres casos (null al tomar, ahora al resolver, null de
  // nuevo al reabrir). Con COALESCE no se podia limpiar una resolucion previa.
  async updateStatus (ticketId, { status, first_response_at: firstResponseAt, resolved_at: resolvedAt = null }) {
    await this.db.query(`
      UPDATE public.tickets
         SET status = $2,
             first_response_at = $3,
             resolved_at = $4,
             modification_date = now()
       WHERE ticket_id = $1`, [ticketId, status, firstResponseAt, resolvedAt])
  }

  async reassign (ticketId, nuevoAsignadoId) {
    await this.db.query(`
      UPDATE public.tickets
         SET assigned_to_id = $2, modification_date = now()
       WHERE ticket_id = $1`, [ticketId, nuevoAsignadoId])
  }

  /**
   * Asigna un ABIERTO sin dueño a quien lo toma. El WHERE es el candado: si dos
   * agentes lo toman a la vez, solo uno actualiza la fila. Devuelve si lo logro.
   */
  async claim (ticketId, userId) {
    const { rowCount } = await this.db.query(`
      UPDATE public.tickets
         SET assigned_to_id = $2, modification_date = now()
       WHERE ticket_id = $1 AND status = 'ABIERTO' AND assigned_to_id IS NULL`, [ticketId, userId])
    return rowCount > 0
  }

  async saveSlackThread (ticketId, { channelId, messageTs }) {
    await this.db.query(`
      UPDATE public.tickets
         SET slack_channel_id = $2, slack_message_ts = $3
       WHERE ticket_id = $1`, [ticketId, channelId, messageTs])
  }

  // ── Comentarios ──────────────────────────────────────────────────────────

  async comments (ticketId) {
    const { rows } = await this.db.query(`
      SELECT c.ticket_comment_id, c.ticket_id, c.body, c.registration_date,
             c.author_id, u.name AS autor, u.alias AS autor_alias,
             COALESCE((
               SELECT json_agg(json_build_object(
                        'id', a.ticket_comment_attachment_id,
                        'nombre', a.original_name,
                        'mime', a.mime_type,
                        'bytes', a.size_bytes) ORDER BY a.ticket_comment_attachment_id)
                 FROM public.ticket_comment_attachments a
                WHERE a.ticket_comment_id = c.ticket_comment_id AND a.active = 'Y'
             ), '[]'::json) AS adjuntos
        FROM public.ticket_comments c
        JOIN public.users u ON u.user_id = c.author_id
       WHERE c.ticket_id = $1 AND c.active = 'Y'
       ORDER BY c.ticket_comment_id`, [ticketId])
    return rows
  }

  async createComment (ticketId, autorId, cuerpo, archivos = []) {
    return withTransaction(async (client) => {
      const { rows } = await client.query(`
        INSERT INTO public.ticket_comments (ticket_id, author_id, body, user_registration_id)
        VALUES ($1,$2,$3,$2)
        RETURNING ticket_comment_id`, [ticketId, autorId, cuerpo])
      const comentarioId = rows[0].ticket_comment_id

      for (const a of archivos) {
        await client.query(`
          INSERT INTO public.ticket_comment_attachments (
            ticket_comment_id, original_name, stored_name, mime_type, size_bytes, user_registration_id)
          VALUES ($1,$2,$3,$4,$5,$6)`,
        [comentarioId, a.original_name, a.stored_name, a.mime_type, a.size_bytes, autorId])
      }

      return comentarioId
    })
  }

  // ── Adjuntos ─────────────────────────────────────────────────────────────
  //
  // Devuelven el adjunto junto al ticket dueno para que el caso de uso pueda
  // decidir el acceso con una sola consulta.

  async attachment (attachmentId) {
    const { rows } = await this.db.query(`
      SELECT a.ticket_attachment_id AS id, a.original_name, a.stored_name, a.mime_type,
             t.ticket_id, t.created_by_id, t.assigned_to_id,
             COALESCE((SELECT array_agg(DISTINCT r.alias)
                         FROM public.user_roles ur
                         JOIN public.rol r ON r.rol_id = ur.rol_id
                        WHERE ur.user_id = t.created_by_id), '{}')::text[] AS creador_roles
        FROM public.ticket_attachments a
        JOIN public.tickets t ON t.ticket_id = a.ticket_id
       WHERE a.ticket_attachment_id = $1 AND a.active = 'Y'`, [attachmentId])
    return rows[0] ?? null
  }

  async commentAttachment (attachmentId) {
    const { rows } = await this.db.query(`
      SELECT a.ticket_comment_attachment_id AS id, a.original_name, a.stored_name, a.mime_type,
             t.ticket_id, t.created_by_id, t.assigned_to_id,
             COALESCE((SELECT array_agg(DISTINCT r.alias)
                         FROM public.user_roles ur
                         JOIN public.rol r ON r.rol_id = ur.rol_id
                        WHERE ur.user_id = t.created_by_id), '{}')::text[] AS creador_roles
        FROM public.ticket_comment_attachments a
        JOIN public.ticket_comments c ON c.ticket_comment_id = a.ticket_comment_id
        JOIN public.tickets t ON t.ticket_id = c.ticket_id
       WHERE a.ticket_comment_attachment_id = $1 AND a.active = 'Y'`, [attachmentId])
    return rows[0] ?? null
  }

  // ── Politicas de SLA ─────────────────────────────────────────────────────

  async slaPolicies () {
    const { rows } = await this.db.query(`
      SELECT p.priority, p.first_response_minutes, p.resolution_minutes,
             p.modification_date, u.name AS actualizado_por
        FROM public.ticket_sla_policies p
        LEFT JOIN public.users u ON u.user_id = p.updated_by_id
       ORDER BY CASE p.priority WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END`)
    return rows
  }

  async slaPolicy (priority) {
    const { rows } = await this.db.query(
      'SELECT priority, first_response_minutes, resolution_minutes FROM public.ticket_sla_policies WHERE priority = $1',
      [priority])
    return rows[0] ?? null
  }

  async saveSlaPolicy ({ prioridad, minutosPrimeraRespuesta, minutosResolucion }, userId) {
    const { rows } = await this.db.query(`
      UPDATE public.ticket_sla_policies
         SET first_response_minutes = $2,
             resolution_minutes     = $3,
             updated_by_id          = $4,
             modification_date      = now()
       WHERE priority = $1
       RETURNING priority, first_response_minutes, resolution_minutes`,
    [prioridad, minutosPrimeraRespuesta, minutosResolucion, userId])
    return rows[0] ?? null
  }

  // ── Colas del cron ───────────────────────────────────────────────────────

  /**
   * ABIERTOS sin asignar cuyo tiempo de gracia ya paso: nacieron sin agente a
   * proposito (ver createTicket) para que un admin pueda tomarlos a mano
   * dentro de la ventana; pasado el corte, el cron los reparte solo.
   */
  async unassignedOlderThan (cutoff) {
    const { rows } = await this.db.query(`
      SELECT t.ticket_id, t.title, t.registration_date
        FROM public.tickets t
       WHERE t.active = 'Y'
         AND t.status = 'ABIERTO'
         AND t.assigned_to_id IS NULL
         AND t.registration_date <= $1`, [cutoff])
    return rows
  }

  /**
   * Abiertos CON dueño que nadie tomo y todavia no fueron escalados. Los
   * abiertos SIN dueño son terreno de unassignedOlderThan/tickets-autoassign:
   * mientras estan en su ventana de gracia no tienen a quien "excluir" del
   * reparto, asi que no son candidatos a escalamiento.
   */
  async escalationCandidates () {
    const { rows } = await this.db.query(`
      SELECT t.ticket_id, t.assigned_to_id, t.registration_date,
             t.first_response_due_at, t.first_response_at, t.resolution_due_at, t.resolved_at
        FROM public.tickets t
       WHERE t.active = 'Y'
         AND t.status = 'ABIERTO'
         AND t.assigned_to_id IS NOT NULL
         AND t.escalated_at IS NULL
         AND t.first_response_due_at IS NOT NULL`)
    return rows
  }

  async applyEscalation (ticketId, nuevoAsignadoId, anteriorId, ahora) {
    await this.db.query(`
      UPDATE public.tickets
         SET assigned_to_id = $2, escalated_from_id = $3, escalated_at = $4, modification_date = now()
       WHERE ticket_id = $1 AND escalated_at IS NULL`, [ticketId, nuevoAsignadoId, anteriorId, ahora])
  }

  /**
   * Relojes vencidos cuyo aviso todavia no salio. El WHERE replica los indices
   * parciales del DDL, asi que el barrido no recorre el historico.
   */
  async overdueClocks (ahora) {
    const { rows } = await this.db.query(`
      SELECT t.ticket_id, t.title, t.priority, t.registration_date,
             t.first_response_due_at, t.first_response_at, t.response_alert_sent_at,
             t.resolution_due_at, t.resolved_at, t.resolution_alert_sent_at,
             au.name AS asignado, cu.name AS creador
        FROM public.tickets t
        JOIN public.users cu ON cu.user_id = t.created_by_id
        LEFT JOIN public.users au ON au.user_id = t.assigned_to_id
       WHERE t.active = 'Y'
         AND ((t.first_response_at IS NULL AND t.response_alert_sent_at   IS NULL AND t.first_response_due_at < $1)
           OR (t.resolved_at       IS NULL AND t.resolution_alert_sent_at IS NULL AND t.resolution_due_at     < $1))`,
    [ahora])
    return rows
  }

  /**
   * Sella el aviso de un reloj. Se llama SOLO despues de que Slack confirmo: si
   * el webhook esta caido el aviso queda pendiente y sale en la proxima corrida.
   */
  async sealAlert (ticketId, reloj, ahora) {
    const columna = reloj === 'respuesta' ? 'response_alert_sent_at' : 'resolution_alert_sent_at'
    await this.db.query(
      `UPDATE public.tickets SET ${columna} = $2 WHERE ticket_id = $1 AND ${columna} IS NULL`,
      [ticketId, ahora])
  }

  // ── Identidad (bot de Slack por DM) ──────────────────────────────────────

  async findActiveUserByEmail (email) {
    const { rows } = await this.db.query(`
      SELECT u.user_id, u.name, u.alias, u.email
        FROM public.users u
       WHERE u.active = 'Y' AND lower(u.email) = lower($1)
       LIMIT 1`, [email])
    return rows[0] ?? null
  }
}

export const ticketsRepository = new TicketsRepository()
