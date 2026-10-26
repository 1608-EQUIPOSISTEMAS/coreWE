import { pool } from '../../shared/db/pool.js'

// Unico que habla con academic_membership_checks. SQL plano (sin SPs): la tabla
// es nueva y su DDL vive en scripts/ddl-academica-membresia-checks.sql.

// ponytail: trae todos los checks y el usecase los cruza con los socios
// vigentes; filtrar por enrollment_id = ANY($1) si la tabla crece a cientos de miles.
export async function listChecks () {
  const { rows } = await pool.query('SELECT enrollment_id, checkpoint FROM public.academic_membership_checks')
  return rows
}

export async function markCheck (enrollmentId, checkpoint, userId) {
  await pool.query(
    `INSERT INTO public.academic_membership_checks (enrollment_id, checkpoint, user_registration_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (enrollment_id, checkpoint) DO NOTHING`,
    [enrollmentId, checkpoint, userId]
  )
}

export async function unmarkCheck (enrollmentId, checkpoint) {
  await pool.query(
    'DELETE FROM public.academic_membership_checks WHERE enrollment_id = $1 AND checkpoint = $2',
    [enrollmentId, checkpoint]
  )
}
