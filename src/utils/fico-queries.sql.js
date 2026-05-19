// Queries reusables sobre la tabla enrollments. Centralizan los lookups que
// aparecian repetidos en fico.service.js. Todas aceptan `executor` opcional
// (pool por default) para que se puedan invocar tanto fuera como dentro de
// una transaccion (en ese caso pasar el client de withTransaction).

import { pool } from '../config/db.js'

// Devuelve los identificadores de Odoo asociados a una inscripcion.
// `null` si la inscripcion no existe o no tiene matricula en Odoo.
// Nota: `odoo_activation` NO esta en enrollments (vive en programs/program_versions);
// si lo necesitas, agregar el JOIN explicito en el call site.
export async function getEnrollmentOdoo (enrollmentId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT odoo_user_id, odoo_order_id, odoo_email, odoo_password
       FROM enrollments WHERE enrollment_id = $1`,
    [enrollmentId]
  )
  return rows?.[0] || null
}

// Devuelve los IDs de programa y edicion de una inscripcion.
// Util para validaciones, snapshots y SPs que reciben la edicion como parametro.
export async function getEnrollmentProgramIds (enrollmentId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT program_version_id, program_edition_id
       FROM enrollments WHERE enrollment_id = $1`,
    [enrollmentId]
  )
  return rows?.[0] || null
}

// Devuelve el precio activo del program version (orden DESC por price_id para
// quedarse con el ultimo registrado). Null si el programa no tiene precio.
export async function getProgramPrice (programVersionId, executor = pool) {
  const { rows } = await executor.query(`
    SELECT pp.price_student_soles, pp.price_student_dollars,
           pp.price_profesional_soles, pp.price_profesional_dollars,
           pp.reservation_price_soles, pp.reservation_price_dollars
    FROM program_price pp
    WHERE pp.program_version_id = $1 AND pp.active = 'Y'
    ORDER BY pp.program_price_id DESC LIMIT 1
  `, [programVersionId])
  return rows?.[0] || null
}
