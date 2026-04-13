import { pool } from '../config/db.js'
import { callProcedureReturningRows } from '../utils/spHelper.js'

async function enrollmentList (payload = {}) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_fico_enrollment_list',
    [JSON.stringify(payload)],
    { statementTimeoutMs: 25000 }
  )

  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0

  return {
    total,
    page: Number(payload.page || 1),
    size: Number(payload.size || 25),
    items: rows
  }
}

async function paymentDetailGet ({ enrollment_id }) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_fico_payment_detail_get',
    [enrollment_id],
    { statementTimeoutMs: 25000 }
  )

  return rows?.[0] || null
}


export default {
  enrollmentList,
  paymentDetailGet
}
