// 18279 (CESAR ATAHUALPA / POWER APPS AVANZ): el Sheet '0. Ventas Sistemas'
// mostraba F.PAGO 01/09 y el ERP 31/08.
//
// La columna F.PAGO de las hojas sale de la cascada
// leads.pay_date -> primer payments.payment_date -> registration_date, y
// leads.pay_date gana. La venta nacio de un link de pago (pay_date = el dia en
// que se creo, 01/09) y al confirmar, FICO grabo la fecha real (31/08) en
// payments; leads.pay_date quedo en 01/09.
//
// Por que no lo sincronizo solo: confirmPayment llama a syncLeadPayDate, pero
// el trigger leads.block_update_when_enrolled prohibe TODO update sobre un lead
// que ya tiene enrollment_id -- justo la condicion en la que corre el sync. La
// excepcion muere en un console.error y nadie se entera.
//
// Por eso el script apaga los triggers de la sesion (session_replication_role,
// no DDL: no toma lock ni deja rastro cuando la conexion se cierra).
//
// Correr contra produccion:
//   DOTENV_CONFIG_PATH=.env.bak-produccion node scripts/fix-pay-date-18279.mjs
import { pool } from './db.mjs'

const ID = 18279

const SNAPSHOT = `
  SELECT l.lead_id, l.pay_date::date AS pay_date,
         (SELECT py.payment_date::date FROM public.payments py
           WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y'
           ORDER BY py.payment_date ASC LIMIT 1) AS payment_date
    FROM public.enrollments e
    JOIN public.leads l ON l.enrollment_id = e.enrollment_id
   WHERE e.enrollment_id = $1`

const dia = (d) => d?.toISOString().slice(0, 10) ?? null

const client = await pool.connect()
try {
  const { rows: [antes] } = await client.query(SNAPSHOT, [ID])
  console.log('ANTES  ', antes)

  await client.query('BEGIN')
  await client.query("SET LOCAL session_replication_role = 'replica'")
  const { rowCount } = await client.query(`
    UPDATE public.leads l
       SET pay_date = fp.payment_date::date
      FROM (
        SELECT py.payment_date FROM public.payments py
         WHERE py.enrollment_id = $1 AND py.active = 'Y'
         ORDER BY py.payment_date ASC LIMIT 1
      ) fp
     WHERE l.enrollment_id = $1
       AND l.pay_date IS DISTINCT FROM fp.payment_date::date`, [ID])
  await client.query('COMMIT')

  const { rows: [despues] } = await client.query(SNAPSHOT, [ID])
  console.log('DESPUES', despues, `(filas actualizadas: ${rowCount})`)

  if (dia(despues.pay_date) !== dia(despues.payment_date)) {
    throw new Error('leads.pay_date sigue sin coincidir con el pago activo')
  }
} finally {
  client.release()
  await pool.end()
}
