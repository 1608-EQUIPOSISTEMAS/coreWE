import { pool } from '../../shared/db/pool.js'

// Unico que habla con la BD. SQL plano (sin SPs): la tabla es nueva y su DDL
// vive versionado en scripts/ddl-pagos-adicionales.sql, mismo criterio que
// tickets.

const SELECT = `
  SELECT
    a.additional_payment_id,
    a.business_line,
    a.program,
    a.subject,
    to_char(a.payment_date, 'YYYY-MM-DD') AS payment_date,
    a.full_name,
    a.phone,
    a.email,
    a.status,
    a.done,
    a.amount,
    a.currency,
    a.cat_payment_medium,
    a.cat_business_entity,
    a.bank_account_id,
    a.transaction_code,
    a.product_line,
    a.payment_type,
    med.description AS medio_pago,
    emp.alias       AS empresa_alias,
    emp.description AS empresa,
    ba.bank_name    AS banco,
    u.email         AS registrado_por
  FROM public.fico_additional_payments a
  LEFT JOIN public.catalog med      ON med.catalog_id = a.cat_payment_medium
  LEFT JOIN public.catalog emp      ON emp.catalog_id = a.cat_business_entity
  LEFT JOIN public.bank_accounts ba ON ba.account_id = a.bank_account_id
  LEFT JOIN public.users u          ON u.user_id = a.user_registration_id`

// Pagos activos con F. pago en [inicio, fin).
export async function listPagos (inicio, fin) {
  const { rows } = await pool.query(
    `${SELECT}
      WHERE a.active = 'Y' AND a.payment_date >= $1 AND a.payment_date < $2
      ORDER BY a.additional_payment_id`,
    [inicio, fin]
  )
  return rows
}

export async function getPago (id) {
  const { rows } = await pool.query(`${SELECT} WHERE a.additional_payment_id = $1 AND a.active = 'Y'`, [id])
  return rows[0] ?? null
}

export async function getCuenta (accountId) {
  const { rows } = await pool.query(
    'SELECT account_id, business_entity_catalog_id, bank_name, currency FROM public.bank_accounts WHERE account_id = $1',
    [accountId]
  )
  return rows[0] ?? null
}

const CAMPOS = [
  'business_line', 'program', 'subject', 'payment_date', 'full_name', 'phone', 'email', 'status', 'done',
  'amount', 'currency', 'cat_payment_medium', 'cat_business_entity', 'bank_account_id', 'transaction_code',
  'product_line', 'payment_type'
]

export async function insertPago (pago, userId) {
  const cols = [...CAMPOS, 'user_registration_id']
  const { rows } = await pool.query(
    `INSERT INTO public.fico_additional_payments (${cols.join(', ')})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING additional_payment_id`,
    [...CAMPOS.map(k => pago[k]), userId]
  )
  return rows[0].additional_payment_id
}

export async function updatePago (id, pago, userId) {
  const sets = CAMPOS.map((k, i) => `${k} = $${i + 1}`)
  const { rowCount } = await pool.query(
    `UPDATE public.fico_additional_payments
        SET ${sets.join(', ')}, modification_date = now(), user_modification_id = $${CAMPOS.length + 1}
      WHERE additional_payment_id = $${CAMPOS.length + 2} AND active = 'Y'`,
    [...CAMPOS.map(k => pago[k]), userId, id]
  )
  return rowCount
}

// Baja logica: el N° no se reutiliza y la fila queda para auditoria.
export async function anularPago (id, userId) {
  const { rowCount } = await pool.query(
    `UPDATE public.fico_additional_payments
        SET active = 'N', modification_date = now(), user_modification_id = $1
      WHERE additional_payment_id = $2 AND active = 'Y'`,
    [userId, id]
  )
  return rowCount
}
