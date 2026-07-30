// Correccion enrollment 10598 (GAMARRA RUIZ DIANA PATRICIA, PY-DZ-05 E34) contra hoja FICO filas 46/47.
// Idempotente: guardas NOT EXISTS / WHERE en cada paso. Una sola conexion, una sola transaccion.
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

const m = (process.env.DATABASE_URL || '').match(/^postgresql:\/\/([^:]+):([^@]+)@/)
const pw = process.env.PGPASSWORD || (m ? decodeURIComponent(m[2]) : null)
const EID = 10598

async function conectar (intentos = 5) {
  for (let i = 1; i <= intentos; i++) {
    const cli = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'neondb', user: 'postgres', password: pw, connectionTimeoutMillis: 10000 })
    try { await cli.connect(); return cli } catch (e) {
      console.error('[intento ' + i + '] tunel caido: ' + e.message)
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  throw new Error('no se pudo conectar tras varios intentos')
}

const c = await conectar()
try {
  // ---- BACKUP previo ----
  const backup = {}
  backup.enrollment = (await c.query('select * from enrollments where enrollment_id=$1', [EID])).rows
  backup.installments = (await c.query('select * from payment_installments where enrollment_id=$1 order by installment_number', [EID])).rows
  backup.payments = (await c.query('select * from payments where enrollment_id=$1 order by payment_id', [EID])).rows
  backup.discounts = (await c.query('select * from enrollment_discounts where enrollment_id=$1', [EID])).rows
  fs.writeFileSync(new URL('./_backup_10598_2026-07-30.json', import.meta.url), JSON.stringify(backup, null, 2))
  console.log('backup escrito: scripts/_backup_10598_2026-07-30.json')

  await c.query('BEGIN')

  // 1) Cabecera: lista 3400, 50% global (1700) + GIFT CARD S/50 (50) => descuento 1750, total 1650
  const NOTA = ' | Correccion 30/07/2026: lista 3400 con 50% global + GIFT CARD S/50 (regalo, no descuento) -> total 1650; inicial 300 y 5 cuotas de 270 pagadas (Mercado Pago) restauradas de la hoja'
  const up = await c.query(
    'update enrollments set total_amount = 1650.00, list_price = 3400.00, discount_amount = 1750.00, ' +
    "notes = case when notes like '%Correccion 30/07/2026%' then notes else notes || $2 end, " +
    'user_modification_id = 9, modification_date = now() ' +
    'where enrollment_id = $1 returning total_amount, list_price, discount_amount, notes', [EID, NOTA])
  console.log('1) cabecera:', up.rows[0])

  // 2) Inicial: normalizar cat_status 2471 (modelo viejo) -> 4454
  const r2 = await c.query(
    'update payment_installments set cat_status = 4454 where enrollment_id=$1 and installment_number=0 and cat_status = 2471', [EID])
  console.log('2) inicial 2471->4454:', r2.rowCount)

  // 3) enrollment_discounts: 12 = GLOBAL 50% (1700), 19 = GIFT CARD 50 (50)
  const r3 = await c.query(
    'insert into enrollment_discounts (enrollment_id, discount_id, applied_at, user_registration_id, order_applied, calculated_amount) ' +
    'select $1, v.did, now(), 9, v.ord, v.amt ' +
    'from (values (12, 1, 1700.00), (19, 3, 50.00)) as v(did, ord, amt) ' +
    'where not exists (select 1 from enrollment_discounts ed where ed.enrollment_id=$1 and ed.discount_id=v.did)', [EID])
  console.log('3) descuentos insertados:', r3.rowCount)

  // 4) 5 cuotas de 270 pagadas + sus pagos Mercado Pago (3256, sin cuenta ni n. operacion)
  const r4 = await c.query(
    'with ins as ( ' +
    '  insert into payment_installments (enrollment_id, installment_number, amount, penalty_amount, due_date, cat_status, notes) ' +
    '  select $1, v.n, v.amt, 0, v.d, 4454, null ' +
    "  from (values (1, 270.00, date '2026-03-19'), (2, 270.00, date '2026-05-01'), (3, 270.00, date '2026-05-01'), " +
    "               (4, 270.00, date '2026-07-29'), (5, 270.00, date '2026-07-29')) as v(n, amt, d) " +
    '  where not exists (select 1 from payment_installments pi where pi.enrollment_id=$1 and pi.installment_number > 0) ' +
    '  returning installment_id, installment_number, amount, due_date ' +
    ') ' +
    'insert into payments (enrollment_id, installment_id, amount, payment_date, transaction_code, evidence_url, ' +
    '                      cat_method_payment, cat_payment_type, cat_settlement_status, settled_in_account_id, ' +
    "                      active, user_registration_id, registration_date) " +
    "select $1, ins.installment_id, ins.amount, ins.due_date, null, null, 3256, 3115, 2573, null, 'Y', 9, now() " +
    'from ins returning payment_id, installment_id, amount, payment_date::date', [EID])
  console.log('4) cuotas+pagos creados:', r4.rowCount)
  console.table(r4.rows)

  // 5) Sanity ANTES del commit
  const s = (await c.query(
    'select e.total_amount, e.list_price, e.discount_amount, ' +
    '  (select coalesce(sum(amount),0) from payment_installments where enrollment_id=e.enrollment_id) suma_cuotas, ' +
    '  (select coalesce(sum(amount),0) from payment_installments where enrollment_id=e.enrollment_id and cat_status in (4454,2471)) pagado, ' +
    "  (select coalesce(sum(amount),0) from payments where enrollment_id=e.enrollment_id and active='Y' and installment_id is not null) suma_pagos, " +
    '  (select coalesce(sum(calculated_amount),0) from enrollment_discounts where enrollment_id=e.enrollment_id) suma_desc ' +
    'from enrollments e where e.enrollment_id=$1', [EID])).rows[0]
  console.log('5) sanity:', s)
  const n = (x) => Number(x)
  if (n(s.suma_cuotas) !== n(s.total_amount)) throw new Error('sum(cuotas)=' + s.suma_cuotas + ' != total=' + s.total_amount)
  if (n(s.suma_pagos) !== n(s.total_amount)) throw new Error('sum(pagos)=' + s.suma_pagos + ' != total=' + s.total_amount)
  if (n(s.pagado) !== 1650) throw new Error('pagado=' + s.pagado + ' != 1650 (saldo debe ser 0)')
  if (n(s.suma_desc) !== n(s.discount_amount)) throw new Error('sum(descuentos)=' + s.suma_desc + ' != discount_amount=' + s.discount_amount)
  if (n(s.list_price) - n(s.discount_amount) !== n(s.total_amount)) throw new Error('lista - descuento != total')

  // 6) Audit
  const JUST = 'Ajuste de Importacion: enrollment mal importado (hoja FICO filas 46/47). Se restauro lista 3400 con 50% global + GIFT CARD S/50 (regalo, no descuento) => total 1650, y las 5 cuotas de 270 pagadas por Mercado Pago que el importador no creo. Inicial 300 del 26/12/2025 normalizada a cat_status 4454.'
  const CHANGES = JSON.stringify({
    total_amount: { old: 1530.00, new: 1650.00 },
    list_price: { old: 1530.00, new: 3400.00 },
    discount_amount: { old: 0.00, new: 1750.00 },
    enrollment_discounts_added: [{ discount_id: 12, label: 'GLOBAL 50%', amount: 1700 }, { discount_id: 19, label: 'GIFT CARD 50', amount: 50 }],
    installments_created: 5,
    installment_amount: 270,
    payments_created: 5,
    payment_medium: 3256,
    initial_installment_status: { old: 2471, new: 4454 },
    source: 'hoja FICO fila 46 (principal) + fila 47 (cuotas)'
  })
  const r6 = await c.query(
    'insert into enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes) ' +
    "select $1, 'edited', 9, $2, $3::jsonb " +
    "where not exists (select 1 from enrollment_audit_log a where a.enrollment_id=$1 and a.action='edited' " +
    "  and a.justificacion like 'Ajuste de Importacion: enrollment mal importado%')", [EID, JUST, CHANGES])
  console.log('6) audit insertado:', r6.rowCount)

  await c.query('COMMIT')
  console.log('\n>>> COMMIT OK')

  // 7) Refresh de la matview (fuera de la transaccion)
  console.log('7) refrescando mv_enrollment_report_system...')
  await c.query('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')
  console.log('   refresh OK')
} catch (e) {
  try { await c.query('ROLLBACK') } catch { /* noop */ }
  console.error('\n!!! ROLLBACK:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
