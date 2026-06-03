// Forma de salida hacia el cliente. Mantiene paridad con el service legacy.
// Invariante: register expone registration_date; update expone modification_date.

export const toRegisterDto = ({ row, id }) => ({
  agreement_id: row.agreement_id ?? id ?? null,
  data: {
    agreement_id: row.agreement_id,
    company_id: row.company_id,
    company_label: row.company_label,
    intermediary_id: row.intermediary_id,
    intermediary_label: row.intermediary_label,
    discount_live_pct: row.discount_live_pct,
    discount_online_pct: row.discount_online_pct,
    start_date: row.start_date,
    end_date: row.end_date,
    active: row.active,
    registration_date: row.registration_date
  }
})

export const toUpdateDto = ({ row, id }) => ({
  agreement_id: row.agreement_id ?? id ?? null,
  data: {
    agreement_id: row.agreement_id,
    company_id: row.company_id,
    company_label: row.company_label,
    intermediary_id: row.intermediary_id,
    intermediary_label: row.intermediary_label,
    discount_live_pct: row.discount_live_pct,
    discount_online_pct: row.discount_online_pct,
    start_date: row.start_date,
    end_date: row.end_date,
    active: row.active,
    modification_date: row.modification_date
  }
})

export const toListDto = ({ rows, page, size }) => ({
  total: rows?.[0]?.total_count ? Number(rows[0].total_count) : 0,
  page: Number(page),
  size: Number(size),
  items: rows.map(r => ({
    agreement_id: r.agreement_id,
    company_id: r.company_id,
    company_name: r.company_name,
    company_commercial_name: r.company_commercial_name,
    intermediary_id: r.intermediary_id,
    intermediary_name: r.intermediary_name,
    full_label: r.full_label,
    discount_live_pct: r.discount_live_pct,
    discount_online_pct: r.discount_online_pct,
    start_date: r.start_date,
    end_date: r.end_date,
    active: r.active,
    registration_date: r.registration_date
  }))
})

export const toCallerDto = (rows) => rows.map(r => ({
  agreement_id: r.agreement_id,
  company_id: r.company_id,
  razon_social: r.razon_social,
  full_label: r.full_label,
  discount_live_pct: r.discount_live_pct,
  discount_online_pct: r.discount_online_pct
}))
