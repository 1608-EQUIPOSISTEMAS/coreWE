import { pool } from '../../shared/db/pool.js'
import { DomainError } from '../../shared/errors.js'

// Unico que habla con public.scholarships. SQL plano (sin SPs): la tabla es
// nueva y su DDL se aplica al arrancar (src/config/startup-schema.js).

const TODAY_LIMA = `to_char((NOW() AT TIME ZONE 'America/Lima')::date, 'YYYY-MM-DD')`

// Programa -> modalidad sin pasar por la version de la edicion: la beca online
// no tiene edicion.
const PROGRAM_MODALITY = `
  JOIN public.programs p ON p.program_id = s.program_id
  LEFT JOIN public.catalog cm ON cm.catalog_id = p.cat_model_modality`

export async function today () {
  const { rows } = await pool.query(`SELECT ${TODAY_LIMA} AS today`)
  return rows[0].today
}

// ponytail: trae todas las becas (hoy ~30 al año); paginar en SQL si pasan de miles.
export async function listScholarships () {
  const { rows } = await pool.query(`
    SELECT s.scholarship_id, s.agreement_type, s.partner_name, s.beneficiary_name,
           s.document_number, s.email, s.phone, s.career, s.scholarship_type,
           s.program_id, p.program_name, COALESCE(cm.description, 'Sin modalidad') AS modality,
           s.program_edition_id, pe.specific_code,
           to_char(pe.start_date, 'YYYY-MM-DD')        AS edition_start_date,
           to_char(pe.end_date, 'YYYY-MM-DD')          AS edition_end_date,
           to_char(s.activated_at, 'YYYY-MM-DD')       AS activated_at,
           to_char(s.access_until, 'YYYY-MM-DD')       AS access_until,
           to_char(s.registration_date AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS registration_date,
           conv.purchases
      FROM public.scholarships s
      ${PROGRAM_MODALITY}
      LEFT JOIN public.program_editions pe ON pe.edition_num_id = s.program_edition_id
      LEFT JOIN LATERAL (
        -- Conversion: ventas pagadas de OTRO curso hechas despues de la beca. El
        -- mismo curso no cuenta (una semibeca es una venta del curso becado).
        -- ponytail: cruce por DNI exacto; ~6 de 18k persons tienen espacios o
        -- minusculas y no calzarian, normalizar persons si eso crece.
        SELECT count(*)::int AS purchases
          FROM public.persons per
          JOIN public.customers c         ON c.person_id = per.person_id
          JOIN public.enrollments e       ON e.customer_id = c.customer_id
          JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
         WHERE per.document_number = s.document_number
           AND e.active = 'Y' AND e.counts_as_sale AND e.total_amount > 0
           AND e.registration_date > s.registration_date
           AND pv.program_id <> s.program_id
      ) conv ON TRUE
     ORDER BY s.registration_date DESC`)
  return rows
}

// Cursos que se pueden becar: programas activos con su modalidad y, para en
// vivo/presencial, las ediciones que todavia no terminan.
export async function listCourses () {
  const [programs, editions] = await Promise.all([
    pool.query(`
      SELECT p.program_id, p.program_name, cm.alias AS modality_alias, cm.description AS modality
        FROM public.programs p
        JOIN public.catalog cm ON cm.catalog_id = p.cat_model_modality
       WHERE p.active = 'Y' AND NOT COALESCE(p.is_membership, false)
       ORDER BY p.program_name`),
    pool.query(`
      SELECT pe.edition_num_id AS program_edition_id, pv.program_id, pe.specific_code,
             to_char(pe.start_date, 'YYYY-MM-DD') AS start_date,
             to_char(pe.end_date, 'YYYY-MM-DD')   AS end_date
        FROM public.program_editions pe
        JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
       WHERE pe.active = 'Y' AND pe.end_date >= (NOW() AT TIME ZONE 'America/Lima')::date
       ORDER BY pe.start_date`)
  ])
  return { programs: programs.rows, editions: editions.rows }
}

// Destinatarios del aviso diario: usuarios activos de Fundacion con correo.
export async function fundacionEmails () {
  const { rows } = await pool.query(`
    SELECT DISTINCT u.email
      FROM public.users u
      JOIN public.user_roles ur ON ur.user_id = u.user_id
      JOIN public.rol r         ON r.rol_id = ur.rol_id
     WHERE u.active = 'Y' AND r.alias IN ('FUNDACION', 'LIDER_FUNDACION')
       AND NULLIF(TRIM(u.email), '') IS NOT NULL`)
  return rows.map(r => r.email)
}

export async function findCourse (programId, editionId) {
  const { rows } = await pool.query(`
    SELECT cm.alias AS modality_alias,
           EXISTS (SELECT 1 FROM public.program_editions pe
                     JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
                    WHERE pe.edition_num_id = $2 AND pv.program_id = p.program_id) AS edition_matches
      FROM public.programs p
      LEFT JOIN public.catalog cm ON cm.catalog_id = p.cat_model_modality
     WHERE p.program_id = $1`, [programId, editionId])
  return rows[0] || null
}

// La otra beca de la misma persona en el mismo curso/edicion, sin contar la que
// se esta editando (exceptId).
export async function findDuplicate ({ document_number, program_id, program_edition_id }, exceptId = null) {
  const { rows } = await pool.query(`
    SELECT scholarship_id, partner_name
      FROM public.scholarships
     WHERE document_number = $1 AND program_id = $2
       AND program_edition_id IS NOT DISTINCT FROM $3
       AND scholarship_id <> COALESCE($4, 0)
     LIMIT 1`, [document_number, program_id, program_edition_id, exceptId])
  return rows[0] || null
}

// El usecase ya busco el duplicado; esto solo cubre dos guardados simultaneos
// que choquen contra scholarships_person_course_uq.
const UNIQUE_VIOLATION = '23505'
async function guardDuplicate (write) {
  try {
    return await write()
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) throw new DomainError('Esta persona ya tiene una beca en este curso.', { statusCode: 409 })
    throw err
  }
}

// Columnas editables en el orden de $1..$11 del INSERT y del UPDATE.
const editableValues = s => [s.agreement_type, s.partner_name, s.beneficiary_name, s.document_number,
  s.email, s.phone, s.career, s.program_id, s.program_edition_id, s.scholarship_type, s.access_until]

export async function insertScholarship (s, userId) {
  const { rows } = await guardDuplicate(() => pool.query(`
    INSERT INTO public.scholarships
      (agreement_type, partner_name, beneficiary_name, document_number, email, phone, career,
       program_id, program_edition_id, scholarship_type, access_until, user_registration_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING scholarship_id`, [...editableValues(s), userId]))
  return rows[0].scholarship_id
}

// No toca activated_at: activar es su propia accion.
export async function updateScholarship (scholarshipId, s) {
  const { rowCount } = await guardDuplicate(() => pool.query(`
    UPDATE public.scholarships
       SET agreement_type = $1, partner_name = $2, beneficiary_name = $3, document_number = $4,
           email = $5, phone = $6, career = $7, program_id = $8, program_edition_id = $9,
           scholarship_type = $10, access_until = $11
     WHERE scholarship_id = $12`, [...editableValues(s), scholarshipId]))
  return rowCount > 0
}

// ponytail: borrado fisico (corrige registros errados); pasar a anulacion con
// fecha y usuario si Fundacion necesita ver el historial de lo borrado.
export async function deleteScholarship (scholarshipId) {
  const { rowCount } = await pool.query('DELETE FROM public.scholarships WHERE scholarship_id = $1', [scholarshipId])
  return rowCount > 0
}

// Solo activa una vez: una beca ya activada conserva su fecha original.
export async function activateScholarship (scholarshipId) {
  const { rowCount } = await pool.query(`
    UPDATE public.scholarships
       SET activated_at = (NOW() AT TIME ZONE 'America/Lima')::date
     WHERE scholarship_id = $1 AND activated_at IS NULL`, [scholarshipId])
  return rowCount > 0
}
