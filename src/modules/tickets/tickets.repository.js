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
        s.resolved_at,
        s.registration_date,
        per.person_id,
        per.document_number AS dni,
        TRIM(concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS alumno,
        mail.value AS correo,
        tel.value  AS celular,
        p.program_name AS programa,
        ed.specific_code AS edicion_codigo,
        ed.start_date    AS edicion_inicio`
  }

  static get DESDE () {
    return `
      FROM public.solicitudes_portal s
      JOIN public.persons per ON per.person_id = s.person_id
      LEFT JOIN public.enrollments e ON e.enrollment_id = s.enrollment_id
      LEFT JOIN public.program_editions ed ON ed.edition_num_id = e.program_edition_id
      LEFT JOIN public.program_versions pv ON pv.program_version_id = ed.program_version_id
      LEFT JOIN public.programs p ON p.program_id = pv.program_id
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
      ) tel ON TRUE`
  }

  /**
   * Tickets que puede ver el area. Incluye los de `area_actual IS NULL` a
   * proposito: son los que Nexus acaba de crear y todavia nadie ruteo. Cual es
   * su area de verdad lo resuelve la entity (areaInicial), no un CASE en SQL —
   * duplicar aca la tabla de pasos es garantizar que se desincronicen.
   */
  async listar ({ areas, incluirCerrados = false, tipo = null, q = null }) {
    const { rows } = await this.db.query(`
      SELECT ${TicketsRepository.CAMPOS}
      ${TicketsRepository.DESDE}
       WHERE s.active = 'Y'
         AND (s.area_actual = ANY($1::varchar[]) OR s.area_actual IS NULL)
         AND ($2::boolean OR s.status NOT IN ('RESUELTA', 'RECHAZADA'))
         AND ($3::varchar IS NULL OR s.tipo = $3)
         AND ($4::varchar IS NULL OR s.ticket_number ILIKE '%' || $4 || '%'
              OR per.document_number ILIKE '%' || $4 || '%'
              OR TRIM(concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) ILIKE '%' || $4 || '%')
       ORDER BY s.registration_date DESC`,
    [areas, incluirCerrados, tipo, q])
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
   * resuelto por nadie.
   */
  async guardarFirma ({ solicitudId, status, areaActual, respuesta, userId, cierra }) {
    const { rows } = await this.db.query(`
      UPDATE public.solicitudes_portal
         SET status = $2,
             area_actual = $3,
             respuesta = COALESCE($4, respuesta),
             resolved_by = CASE WHEN $6 THEN $5 ELSE resolved_by END,
             resolved_at = CASE WHEN $6 THEN now() ELSE resolved_at END,
             modification_date = now()
       WHERE solicitud_id = $1 AND active = 'Y'
      RETURNING solicitud_id, ticket_number, tipo, status, area_actual, respuesta`,
    [solicitudId, status, areaActual, respuesta || null, userId, cierra])
    return rows[0] || null
  }
}

export const ticketsRepository = new TicketsRepository()
