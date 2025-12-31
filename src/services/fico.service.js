//fico enrollmentlist
import { pool } from '../plugins/db.js'
import { callProcedureReturningRows } from '../plugins/spHelper.js'

async function enrollmentList (payload = {}) {
  const {
    q = null,
    cat_type_status = null,
    cat_fico_status = null,
    date_from = null,
    date_to = null,
    seller_agent_id = null,
    validator_user_id = null,
    page = 1,
    size = 25
  } = payload

  const filters = {
    q,
    cat_type_status,
    cat_fico_status,
    date_from,
    date_to,
    seller_agent_id,
    validator_user_id,
    page,
    size
  }

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_fico_enrollment_list',
    [
      q,
      cat_type_status,
      cat_fico_status,
      seller_agent_id,
      validator_user_id,
      date_from,
      date_to,
      page,
      size
    ],
    { statementTimeoutMs: 25000 }
  )

  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0

  return {
    total,
    page: Number(page),
    size: Number(size),
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
