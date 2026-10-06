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

// Precio de lista de la version desde program_pricing, la misma tabla y pivot
// que usa la venta (sp_program_version_caller). Antes leia program_price, que
// solo tenia 63 versiones: el CC cotizaba 0 y no reconocia una membresia
// destino (06/10/26). Perfiles 3087 estudiante / 3086 profesional; monedas
// 3041 PEN / 3042 USD. La reserva sale del perfil estudiante.
export async function getProgramPrice (programVersionId, executor = pool) {
  const { rows } = await executor.query(`
    SELECT MAX(pp.list_price) FILTER (WHERE pp.cat_profile_id = 3087 AND pp.cat_currency_id = 3041) AS price_student_soles,
           MAX(pp.list_price) FILTER (WHERE pp.cat_profile_id = 3087 AND pp.cat_currency_id = 3042) AS price_student_dollars,
           MAX(pp.list_price) FILTER (WHERE pp.cat_profile_id = 3086 AND pp.cat_currency_id = 3041) AS price_profesional_soles,
           MAX(pp.list_price) FILTER (WHERE pp.cat_profile_id = 3086 AND pp.cat_currency_id = 3042) AS price_profesional_dollars,
           MAX(pp.reservation_price) FILTER (WHERE pp.cat_profile_id = 3087 AND pp.cat_currency_id = 3041) AS reservation_price_soles,
           MAX(pp.reservation_price) FILTER (WHERE pp.cat_profile_id = 3087 AND pp.cat_currency_id = 3042) AS reservation_price_dollars,
           COALESCE(prog.is_membership, false) AS is_membership
    FROM program_versions pv
    JOIN programs prog ON prog.program_id = pv.program_id
    LEFT JOIN program_pricing pp ON pp.program_version_id = pv.program_version_id AND pp.active
    WHERE pv.program_version_id = $1
    GROUP BY prog.is_membership
  `, [programVersionId])
  return rows?.[0] || null
}
