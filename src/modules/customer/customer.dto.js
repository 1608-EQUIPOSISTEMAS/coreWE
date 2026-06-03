// Forma de salida hacia el cliente. Mantiene paridad con el service legacy.

export const toRegisterDto = (row) => ({
  customer_id: row.customer_id ?? null
})

export const toUpdateDto = ({ row, id }) => ({
  customer_id: row.customer_id ?? id ?? null
})

export const toCallerDto = (rows) => rows.map(r => ({
  id: r.customer_id,
  full_name: r.full_name,
  document_number: r.document_number,
  person_id: r.person_id,
  company_id: r.company_id
}))

export const toInfoGetDto = (r = {}) => ({
  result: r.result ?? 0,
  message: r.message ?? null,
  person_id: r.person_id ?? null,
  customer_id: r.customer_id ?? null,
  first_name: r.first_name ?? null,
  last_name: r.last_name ?? null,
  mother_last_name: r.mother_last_name ?? null,
  document_number: r.document_number ?? null,
  email: r.email ?? null,
  phone: r.phone ?? null
})
