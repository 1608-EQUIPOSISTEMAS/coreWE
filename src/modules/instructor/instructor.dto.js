// Forma de salida hacia el cliente. Mantiene paridad con el service legacy.

export const toListDto = ({ rows, page, size }) => ({
  total: rows?.[0]?.total_count ? Number(rows[0].total_count) : 0,
  page: Number(page),
  size: Number(size),
  items: rows
})

export const toRegisterDto = ({ row, odoo }) => ({
  instructor_id: row.instructor_id ?? null,
  person_id: row.person_id ?? null,
  odoo_user_id: odoo.odoo_user_id ?? null,
  odoo_partner_id: odoo.odoo_partner_id ?? null,
  odoo_error: odoo.odoo_error ?? null,
  data: row
})

export const toUpdateDto = ({ row, id }) => ({
  instructor_id: row.instructor_id ?? id ?? null,
  person_id: row.person_id ?? null,
  data: row
})
