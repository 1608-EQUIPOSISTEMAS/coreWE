import { pool } from '../../shared/db/pool.js'

// Unico que habla con la BD. La tabla `solicitudes_portal` la escribe el portal
// del alumno (Nexus) y vive en esta misma base: no hay sincronizacion ni espejo.
// Por eso aca NO se inserta nada — solo se lee y se avanza el workflow.
export class TicketsRepository {
  constructor (db = pool) {
    this.db = db
  }

  // El nombre del curso sale de programs.program_name cruzando por ID
  // (edicion -> version -> programa). El campo `programa` del aula es una
  // abreviatura ('GEST PROCESOS') y no sirve para mostrarle al area.
  static get CAMPOS () {
    return `
        s.solicitud_id,
        s.ticket_number,
        s.tipo,
        s.asunto,
        s.detalle,
        s.status,
        s.area_actual,
        s.respuesta,
        s.enrollment_id,
        e.parent_enrollment_id,
        s.datos,
        s.monto::float8 AS monto,
        s.voucher_key,
        s.evidencia_key,
        s.resolved_at,
        s.registration_date,
        per.person_id,
        per.document_number AS dni,
        TRIM(concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS alumno,
        mail.value AS correo,
        tel.value  AS celular,
        COALESCE(p.program_name, pg.program_name) AS programa,
        ed.specific_code AS edicion_codigo,
        ed.start_date    AS edicion_inicio,
        rev.user_id      AS revisor_id,
        rev.nombre       AS revisor,
        rev.created_at   AS revision_inicio,
        pri.created_at   AS primera_revision_at,
        ult.accion       AS ultima_accion,
        ult.nombre       AS ultima_accion_por,
        ult.created_at   AS ultima_accion_at,
        rb.name          AS resuelto_por`
  }

  // Auditoria (solicitudes_portal_eventos). La toma vigente es el ultimo
  // TOMAR/LIBERAR hecho en el estado ACTUAL: cuando el tramite cambia de paso,
  // la toma del area anterior deja de contar sin tener que borrarla.
  static get AUDITORIA () {
    return `
      LEFT JOIN LATERAL (
        SELECT ev.user_id, u.name AS nombre, ev.created_at
          FROM (SELECT * FROM public.solicitudes_portal_eventos x
                 WHERE x.solicitud_id = s.solicitud_id
                   AND x.accion IN ('TOMAR', 'LIBERAR')
                   AND x.status_antes = s.status
                 ORDER BY x.created_at DESC, x.evento_id DESC LIMIT 1) ev
          LEFT JOIN public.users u ON u.user_id = ev.user_id
         WHERE ev.accion = 'TOMAR'
      ) rev ON TRUE
      LEFT JOIN LATERAL (
        SELECT MIN(x.created_at) AS created_at FROM public.solicitudes_portal_eventos x
         WHERE x.solicitud_id = s.solicitud_id AND x.accion = 'TOMAR'
      ) pri ON TRUE
      LEFT JOIN LATERAL (
        SELECT x.accion, u.name AS nombre, x.created_at
          FROM public.solicitudes_portal_eventos x
          LEFT JOIN public.users u ON u.user_id = x.user_id
         WHERE x.solicitud_id = s.solicitud_id
         ORDER BY x.created_at DESC, x.evento_id DESC LIMIT 1
      ) ult ON TRUE
      LEFT JOIN public.users rb ON rb.user_id = s.resolved_by`
  }

  static get DESDE () {
    return `
      FROM public.solicitudes_portal s
      JOIN public.persons per ON per.person_id = s.person_id
      LEFT JOIN public.enrollments e ON e.enrollment_id = s.enrollment_id
      LEFT JOIN public.program_editions ed ON ed.edition_num_id = e.program_edition_id
      LEFT JOIN public.program_versions pv ON pv.program_version_id = ed.program_version_id
      LEFT JOIN public.programs p ON p.program_id = pv.program_id
      LEFT JOIN public.program_versions gv ON gv.program_version_id = (s.datos->>'programVersionId')::int
      LEFT JOIN public.programs pg ON pg.program_id = gv.program_id
      LEFT JOIN LATERAL (
        SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact
                                 AND c.alias = 'we_way_contact_email'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.person_contact_id DESC LIMIT 1
      ) mail ON TRUE
      LEFT JOIN LATERAL (
        SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact
                                 AND c.alias = 'we_way_contact_phone'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.person_contact_id DESC LIMIT 1
      ) tel ON TRUE
      ${TicketsRepository.AUDITORIA}`
  }

  /**
   * Tickets vivos (o todos, con `incluirCerrados`). No filtra por area: de quien
   * es cada ticket depende de su estado (ver `turnoDe` en la entity) y repetir
   * esa regla como CASE en SQL garantiza que se desincronicen.
   */
  async listar ({ incluirCerrados = false, tipo = null, q = null }) {
    const { rows } = await this.db.query(`
      SELECT ${TicketsRepository.CAMPOS}
      ${TicketsRepository.DESDE}
       WHERE s.active = 'Y'
         AND ($1::boolean OR s.status NOT IN ('RESUELTA', 'RECHAZADA', 'PAGO_RECHAZADO'))
         AND ($2::varchar IS NULL OR s.tipo = $2)
         AND ($3::varchar IS NULL OR s.ticket_number ILIKE '%' || $3 || '%'
              OR per.document_number ILIKE '%' || $3 || '%'
              OR TRIM(concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) ILIKE '%' || $3 || '%')
       ORDER BY s.registration_date DESC`,
    [incluirCerrados, tipo, q])
    return rows
  }

  async obtener (solicitudId) {
    const { rows } = await this.db.query(
      `SELECT ${TicketsRepository.CAMPOS} ${TicketsRepository.DESDE}
        WHERE s.solicitud_id = $1 AND s.active = 'Y'`,
      [solicitudId]
    )
    return rows[0] || null
  }

  /**
   * Guarda el resultado de una firma. `resolved_by` y `resolved_at` solo se
   * llenan cuando el tramite queda cerrado: mientras viaja entre areas no esta
   * resuelto por nadie. `datosExtra` se mezcla en `datos` (la matricula nueva
   * que dejo una reprogramacion) sin pisar lo que escribio Nexus.
   */
  async guardarFirma ({ solicitudId, status, areaActual, monto, respuesta, userId, cierra, datosExtra, evento }) {
    // Un solo statement: el cambio de estado y su fila de auditoria se graban
    // juntos o no se graba ninguno. status_antes sale de la fila vieja (FROM
    // previo), no de lo que creyo el caso de uso.
    const { rows } = await this.db.query(`
      WITH previo AS (
        SELECT solicitud_id, status FROM public.solicitudes_portal
         WHERE solicitud_id = $1 AND active = 'Y'
         FOR UPDATE
      ), upd AS (
        UPDATE public.solicitudes_portal sp
           SET status = $2,
               area_actual = $3,
               respuesta = COALESCE($4, sp.respuesta),
               resolved_by = CASE WHEN $6 THEN $5 ELSE sp.resolved_by END,
               resolved_at = CASE WHEN $6 THEN now() ELSE sp.resolved_at END,
               monto = $7,
               datos = sp.datos || COALESCE($8::jsonb, '{}'::jsonb),
               modification_date = now()
          FROM previo
         WHERE sp.solicitud_id = previo.solicitud_id
        RETURNING sp.solicitud_id, sp.ticket_number, sp.tipo, sp.status, sp.area_actual, sp.respuesta,
                  sp.monto::float8 AS monto, previo.status AS status_antes
      ), ev AS (
        INSERT INTO public.solicitudes_portal_eventos
               (solicitud_id, accion, area, status_antes, status_despues, user_id, comentario)
        SELECT solicitud_id, $9, $10, status_antes, status, $5, $4 FROM upd
      )
      SELECT solicitud_id, ticket_number, tipo, status, area_actual, respuesta, monto FROM upd`,
    [solicitudId, status, areaActual, respuesta || null, userId, cierra, monto,
      datosExtra ? JSON.stringify(datosExtra) : null, evento.accion, evento.area])
    return rows[0] || null
  }

  /** TOMAR o LIBERAR: no cambian el estado, solo dejan constancia de quien revisa. */
  async registrarEvento ({ solicitudId, accion, area, status, userId, comentario = null }) {
    const { rows } = await this.db.query(`
      INSERT INTO public.solicitudes_portal_eventos
             (solicitud_id, accion, area, status_antes, status_despues, user_id, comentario)
      VALUES ($1, $2, $3, $4, $4, $5, $6)
      RETURNING evento_id, solicitud_id, accion, area, status_antes, user_id, created_at`,
    [solicitudId, accion, area, status, userId ?? null, comentario])
    return rows[0]
  }

  /** Bitacora completa del tramite, de la mas vieja a la mas nueva. */
  async historial (solicitudId) {
    const { rows } = await this.db.query(`
      SELECT ev.evento_id, ev.accion, ev.area, ev.status_antes, ev.status_despues,
             ev.comentario, ev.created_at, ev.user_id, u.name AS usuario
        FROM public.solicitudes_portal_eventos ev
        LEFT JOIN public.users u ON u.user_id = ev.user_id
       WHERE ev.solicitud_id = $1
       ORDER BY ev.created_at, ev.evento_id`,
    [solicitudId])
    return rows
  }

  /** Moneda de la venta: courseChange la necesita para la inscripcion destino. */
  async monedaDeVenta (enrollmentId) {
    const { rows } = await this.db.query(
      'SELECT cat_currency FROM public.enrollments WHERE enrollment_id = $1',
      [enrollmentId]
    )
    return rows[0]?.cat_currency ?? null
  }
}

export const ticketsRepository = new TicketsRepository()
