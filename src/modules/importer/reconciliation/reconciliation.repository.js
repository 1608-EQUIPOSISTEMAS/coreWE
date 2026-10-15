import { pool } from '../../../shared/db/pool.js'
import { NOT_CURRENT_STATUSES, INSTALLMENT_PAID_STATUSES, INSTALLMENT_VOID_STATUSES } from './reconciliation.entity.js'

// Lecturas de la conciliacion hoja FICO <-> BD. Solo SELECT: la conciliacion no
// escribe (las correcciones son acciones aparte). Una query por concepto para
// toda la hoja, no por fila.

// Enlace de un destino de RP/CC con su origen: lo escriben reprogramEdition y
// courseChange en la nota del destino ("Reprogramacion desde inscripcion #123").
const MOVE_LINK_SQL = `
  substring(e.notes from '(?:Reprogramacion|Cambio de curso) desde inscripcion #([0-9]+)')::int AS move_origin_id,
  CASE WHEN e.notes ~ 'Reprogramacion desde inscripcion #' THEN 'RP'
       WHEN e.notes ~ 'Cambio de curso desde inscripcion #' THEN 'CC' END AS move_kind,
  COALESCE(e.notes, '') ~* 'viene de una? ?(rp|cc)' AS notes_viene_de,
  COALESCE(e.notes, '') LIKE '%masiva FICO%' AS imported`

export class ReconciliationRepository {
  constructor (db = pool) {
    this.db = db
  }

  // Ediciones activas de las versiones (COD) de la hoja: definen el alcance (las
  // historicas no se importan) y la estructura de aulas hijas esperada.
  async activeEditions (versionCodes) {
    const { rows } = await this.db.query(`
      SELECT pe.edition_num_id AS program_edition_id, pv.version_code, pe.global_code
        FROM program_editions pe
        JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
       WHERE pe.active = 'Y' AND UPPER(pv.version_code) = ANY($1::text[])`,
    [versionCodes.map(c => c.toUpperCase())])
    return rows
  }

  // Aulas hijas activas por edicion-padre (mismo criterio que listEditionStructure
  // del importador, que es quien las crea): Map(edicion padre -> [{ edition_id, label }]).
  async structure (editionIds) {
    if (!editionIds.length) return new Map()
    const { rows } = await this.db.query(`
      SELECT es.parent_edition_id, es.child_edition_id AS edition_id,
             pv.version_code || ' ' || pe.global_code AS label
        FROM edition_structure es
        JOIN program_editions pe ON pe.edition_num_id = es.child_edition_id
        JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
       WHERE pe.active = 'Y' AND es.parent_edition_id = ANY($1::int[])`, [editionIds])
    const map = new Map()
    for (const r of rows) {
      const k = Number(r.parent_edition_id)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push({ edition_id: Number(r.edition_id), label: r.label })
    }
    return map
  }

  // Inscripciones padre (sin parent) de las versiones de la hoja, con lo que la
  // conciliacion compara: total, pagos activos, cuotas, hijas vigentes (por aula),
  // membresia, asesor, fecha y el enlace RP/CC.
  async enrollmentsByVersions (versionCodes) {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id, p.document_number,
             TRIM(concat_ws(' ', p.last_name, p.mother_last_name, p.first_name)) AS student,
             pv.version_code, pe.global_code, e.program_edition_id,
             e.total_amount::float8 AS total_amount,
             to_char(e.registration_date, 'YYYY-MM-DD') AS registration_date,
             e.cat_type_status, st.description AS status_label, e.active,
             e.membership_program_id, u.alias AS agent_alias,
             ${MOVE_LINK_SQL},
             COALESCE((SELECT json_agg(json_build_object(
                         'edition_id', ch.program_edition_id,
                         'label', cpv.version_code || ' ' || COALESCE(cpe.global_code, 'sin edicion'))
                         ORDER BY ch.program_edition_id)
                         FROM enrollments ch
                         JOIN program_versions cpv ON cpv.program_version_id = ch.program_version_id
                         LEFT JOIN program_editions cpe ON cpe.edition_num_id = ch.program_edition_id
                        WHERE ch.parent_enrollment_id = e.enrollment_id AND ch.active = 'Y'
                          AND COALESCE(ch.cat_type_status, 0) <> ALL($2::int[])), '[]'::json) AS children,
             COALESCE((SELECT SUM(py.amount) FROM payments py
                        WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y'), 0)::float8 AS paid_amount,
             COALESCE((SELECT json_agg(json_build_object(
                         'n', pi.installment_number, 'amount', pi.amount::float8, 'status', pi.cat_status,
                         'has_payment', EXISTS (SELECT 1 FROM payments x
                                                 WHERE x.installment_id = pi.installment_id AND x.active = 'Y'))
                         ORDER BY pi.installment_number)
                         FROM payment_installments pi WHERE pi.enrollment_id = e.enrollment_id), '[]'::json) AS installments
        FROM enrollments e
        JOIN customers c ON c.customer_id = e.customer_id
        JOIN persons p ON p.person_id = c.person_id
        JOIN program_versions pv ON pv.program_version_id = e.program_version_id
        LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
        LEFT JOIN catalog st ON st.catalog_id = e.cat_type_status
        LEFT JOIN users u ON u.user_id = e.seller_agent_id
       WHERE UPPER(pv.version_code) = ANY($1::text[])
         AND e.parent_enrollment_id IS NULL`,
    [versionCodes.map(c => c.toUpperCase()), NOT_CURRENT_STATUSES])
    return rows
  }

  // Inscripciones padre de los alumnos de la hoja en CUALQUIER programa: ahi
  // viven los destinos de un CC (otro programa, otra hoja) y los destinos
  // importados sueltos que la conciliacion propone como "posible destino".
  async enrollmentsByDocuments (documentNumbers) {
    if (!documentNumbers.length) return []
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id, p.document_number, pv.version_code, pe.global_code, e.program_edition_id,
             e.total_amount::float8 AS total_amount, e.cat_type_status, st.description AS status_label, e.active,
             to_char(e.registration_date, 'YYYY-MM-DD') AS registration_date,
             ${MOVE_LINK_SQL},
             COALESCE(pr.is_membership, false) AS is_membership,
             COALESCE((SELECT SUM(pi.amount) FROM payment_installments pi
                        WHERE pi.enrollment_id = e.enrollment_id
                          AND pi.cat_status <> ALL($2::int[])), 0)::float8 AS pending_amount
        FROM enrollments e
        JOIN customers c ON c.customer_id = e.customer_id
        JOIN persons p ON p.person_id = c.person_id
        JOIN program_versions pv ON pv.program_version_id = e.program_version_id
        JOIN programs pr ON pr.program_id = pv.program_id
        LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
        LEFT JOIN catalog st ON st.catalog_id = e.cat_type_status
       WHERE p.document_number = ANY($1::text[]) AND e.parent_enrollment_id IS NULL`,
    [documentNumbers, [...INSTALLMENT_PAID_STATUSES, ...INSTALLMENT_VOID_STATUSES]])
    return rows
  }
}

export const reconciliationRepository = new ReconciliationRepository()
