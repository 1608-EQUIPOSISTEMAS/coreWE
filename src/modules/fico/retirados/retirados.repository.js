import { pool } from '../../../shared/db/pool.js'
import { STUDENT_EMAIL_SQL, STUDENT_PHONE_SQL } from '../../../utils/student-contacts.sql.js'
import { ALIAS } from '../../../utils/catalog-aliases.js'

// Unico que habla con la BD en el modulo Retirados. `retiro_encuestas` la crea
// el ERP al enviar el correo y la completa Nexus cuando el alumno responde
// (misma BD, sin sincronizacion: scripts/ddl-retiro-encuestas.mjs).
//
// Fecha de retiro: la del boton "Retirar alumno" (enrollment_audit_log) si existe.
// Los retiros que vinieron del import/Sheet no tienen esa fila (los 90 del clon
// al 19/10/26), asi que caen a la ultima modificacion de la inscripcion.

const FECHA_RETIRO_SQL = `COALESCE((ret.at AT TIME ZONE 'America/Lima')::date, e.modification_date::date, e.registration_date::date)`

// Solo el padre: los hijos de un RP/CC tambien quedan en R y no son retiros del alumno.
const RETIRADOS_SQL = `
  SELECT e.enrollment_id,
         TRIM(concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS full_name,
         per.first_name,
         per.document_number,
         ${STUDENT_PHONE_SQL} AS phone,
         ${STUDENT_EMAIL_SQL} AS email,
         COALESCE(pv.abbreviation, pv.version_code, '') AS program_name,
         pe.global_code AS edition_code,
         to_char(${FECHA_RETIRO_SQL}, 'YYYY-MM-DD') AS retiro_date,
         ret.motivo AS motivo_registrado,
         re.envios,
         to_char(re.enviada_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS enviada_at,
         to_char(re.respondida_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS respondida_at,
         re.motivo, re.motivo_otro, re.volveria, re.mejora
  FROM public.enrollments e
  JOIN public."catalog" st ON st.catalog_id = e.cat_type_status AND st.alias = $1
  JOIN public.customers cust ON cust.customer_id = e.customer_id
  JOIN public.persons per    ON per.person_id    = cust.person_id
  LEFT JOIN public.leads l ON l.enrollment_id = e.enrollment_id
  LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
  LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
  LEFT JOIN LATERAL (
    SELECT a.performed_at AS at, a.justificacion AS motivo
    FROM public.enrollment_audit_log a
    WHERE a.enrollment_id = e.enrollment_id AND a.action = 'retired'
    ORDER BY a.performed_at DESC LIMIT 1
  ) ret ON TRUE
  LEFT JOIN public.retiro_encuestas re ON re.enrollment_id = e.enrollment_id
  WHERE e.parent_enrollment_id IS NULL
    AND e.active = 'Y'
    AND ${FECHA_RETIRO_SQL} >= $2::date
    AND ($3::int[] IS NULL OR e.enrollment_id = ANY($3::int[]))
  ORDER BY ${FECHA_RETIRO_SQL} DESC, e.enrollment_id DESC`

export class RetiradosRepository {
  constructor (db = pool) {
    this.db = db
  }

  async listRetirados ({ desde, enrollmentIds = null }) {
    const { rows } = await this.db.query(RETIRADOS_SQL, [ALIAS.ENROLLMENT_STATUS_RETIRED, desde, enrollmentIds])
    return rows
  }

  // Reusa la fila si un envio anterior fallo (envios = 0): el reintento conserva el token.
  async ensureEncuesta ({ enrollmentId, email }) {
    const { rows } = await this.db.query(`
      INSERT INTO public.retiro_encuestas (enrollment_id, email) VALUES ($1, $2)
      ON CONFLICT (enrollment_id) DO UPDATE SET email = EXCLUDED.email
      RETURNING token`, [enrollmentId, email])
    return rows[0].token
  }

  async marcarEnviada ({ enrollmentId, userId }) {
    await this.db.query(`
      UPDATE public.retiro_encuestas
      SET envios = envios + 1, enviada_at = now(), enviada_por = $2
      WHERE enrollment_id = $1`, [enrollmentId, userId])
  }
}

export const retiradosRepository = new RetiradosRepository()
