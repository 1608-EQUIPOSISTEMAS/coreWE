import { pool } from '../../../shared/db/pool.js'
import { STUDENT_EMAIL_SQL, STUDENT_PHONE_SQL } from '../../../utils/student-contacts.sql.js'

// Persistencia del subdominio membership. Envuelve pool.query con las queries
// movidas VERBATIM desde fico.service.js (mismas columnas, mismos parametros,
// mismo orden). No contiene reglas de negocio (viven en membership.entity.js)
// ni efectos externos (Odoo/email/jobs entran por puertos en el usecase).
//
// El "hoy" y la ventana se calculan en SQL contra TZ Lima porque la zona horaria
// del host/DB en prod no es confiable (ver memoria timezone-production).
export class MembershipRepository {
  constructor (db = pool) {
    this.db = db
  }

  // Probe ampliado para la reprogramacion: ademas de la clasificacion, resuelve
  // si ya existe un correo de bienvenida enviado (membresia/sent). Un solo round
  // trip para evitar TOCTOU.
  async findMembershipProbeWithEmailState (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT pv.abbreviation, prog.is_membership,
             EXISTS (
               SELECT 1 FROM public.email_logs el
               WHERE el.enrollment_id = e.enrollment_id
                 AND el.template_type = 'membresia'
                 AND el.status = 'sent'
             ) AS email_already_sent
      FROM enrollments e
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN programs prog ON prog.program_id = pv.program_id
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  // Calcula en TZ Lima si la fecha es hoy/pasado, si excede la ventana de meses,
  // el runAt (fecha + 09:00 Lima) y la fecha normalizada a DATE. windowMonths se
  // pasa como string para concatenar el interval, igual que el legacy.
  async resolveActivationWindow (rawDate, windowMonths) {
    const { rows } = await this.db.query(`
      SELECT
        ($1::date <= (NOW() AT TIME ZONE 'America/Lima')::date)                                            AS is_today_or_past,
        ($1::date > ((NOW() AT TIME ZONE 'America/Lima')::date + ($2 || ' months')::interval)::date)      AS out_of_window,
        (($1::date + TIME '09:00:00') AT TIME ZONE 'America/Lima')                                         AS run_at,
        $1::date                                                                                            AS activation_date
    `, [rawDate, String(windowMonths)])
    return rows?.[0] || null
  }

  // Persiste la nueva fecha de activacion en el enrollment.
  async setActivationDate (enrollmentId, activationDate) {
    await this.db.query(
      'UPDATE enrollments SET membership_activation_date = $2::date WHERE enrollment_id = $1',
      [enrollmentId, activationDate]
    )
  }

  // Datos para inscribir la membresia en Odoo. is_deferred se evalua en TZ Lima:
  // marca true cuando la activacion todavia es futura (defensa del usecase).
  async findEnrollmentForOdoo (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id, per.first_name, per.last_name, per.mother_last_name, per.document_number,
             ${STUDENT_EMAIL_SQL} AS origin_email,
             ${STUDENT_PHONE_SQL} AS origin_phone,
             pv.abbreviation AS program_name,
             e.membership_activation_date,
             (e.membership_activation_date IS NOT NULL
              AND e.membership_activation_date > (NOW() AT TIME ZONE 'America/Lima')::date) AS is_deferred
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cust.person_id
      LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  // Reusa el odoo_user_id de la persona (mismo DNI) si ya existe alguno, para no
  // duplicar usuarios en Odoo entre inscripciones del mismo alumno.
  async findPreviousOdooUserByDocument (documentNumber) {
    const { rows } = await this.db.query(`
      SELECT e.odoo_user_id FROM enrollments e
      JOIN customers c ON c.customer_id = e.customer_id
      JOIN persons p ON p.person_id = c.person_id
      WHERE p.document_number = $1 AND e.odoo_user_id IS NOT NULL
      ORDER BY e.enrollment_id DESC LIMIT 1
    `, [documentNumber])
    return rows?.[0]?.odoo_user_id || null
  }

  // Guarda las credenciales Odoo recien creadas en el enrollment.
  async saveOdooCredentials ({ enrollmentId, odooUserId, odooEmail, odooPassword }) {
    await this.db.query(`
      UPDATE enrollments
      SET odoo_user_id = $1, odoo_email = $3, odoo_password = $4
      WHERE enrollment_id = $2
    `, [odooUserId, enrollmentId, odooEmail, odooPassword])
  }

  // Ids de canal Odoo que Configuracion marco como incluidos en la membresia.
  // Si la tabla aun no existe (instalacion sin pasar por Configuracion) devuelve
  // [] y resolveMembershipChannels cae al comportamiento historico.
  async findMembershipCourseIds () {
    try {
      const { rows } = await this.db.query(
        'SELECT odoo_channel_id FROM public.membership_online_courses'
      )
      return rows.map(r => r.odoo_channel_id)
    } catch (err) {
      console.warn('[membership] No se pudo leer membership_online_courses:', err.message)
      return []
    }
  }

  // Inserta un evento en el audit log. Best-effort: un fallo de auditoria no debe
  // tumbar la reprogramacion (mismo comportamiento que logAudit del legacy).
  async logAudit ({ enrollmentId, action, userId, details = null }) {
    try {
      await this.db.query(`
        INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      `, [enrollmentId, action, userId, null, null, details])
    } catch (err) {
      console.error('[AuditLog] Error:', err.message)
    }
  }
}

export const membershipRepository = new MembershipRepository()
