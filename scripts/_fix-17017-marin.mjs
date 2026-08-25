// Ajustes post-import de MARIN DAVILA (PY-PZ-04 / E34, enr 17017):
//   1. La reserva la crea el SP con vencimiento HOY: va la F. PAGO real (09/04).
//   2. La hoja dice "SE RP 2DO Y 3ER MOD": los modulos 2 y 3 se cursan en las
//      ediciones de las FI de la hoja (23/08 y 04/10), no en las del paquete.
//      Es un RP de hija SEG: se mueve program_edition_id y nada mas (sin correo,
//      sin Odoo, sin fantasma RP en el aula vieja).
//   3. La venta es del 09/04: registration_date = HOY la contaria como venta de
//      agosto en los reportes.
// Todo con guardas por valor actual => re-correrlo no hace nada.
import { pool } from './db.mjs'

// OJO: pool.query() toma una conexion distinta por sentencia, asi que el BEGIN no
// envolveria los UPDATE. La transaccion va sobre UN client reservado.
const cli = await pool.connect()
const q = (t, p) => cli.query(t, p)

const F_REGISTRO = '2026-04-09'
const MUDANZAS = [
  { enr: 17019, de: 15000, a: 15083, curso: 'GEST. AGIL PROYECT E23 -> E25 (23/08/2026)' },
  { enr: 17020, de: 15066, a: 15127, curso: 'MS PROJECT E63 -> E62 (04/10/2026)' }
]

await q('BEGIN')
try {
  const reserva = await q(
    `UPDATE payment_installments SET due_date = $1
      WHERE installment_id = 17556 AND due_date <> $1 RETURNING installment_id`, [F_REGISTRO])

  for (const m of MUDANZAS) {
    const mov = await q(
      `UPDATE enrollments SET program_edition_id = $2, modification_date = now(), user_modification_id = 9
        WHERE enrollment_id = $1 AND program_edition_id = $3 RETURNING enrollment_id`, [m.enr, m.a, m.de])
    if (!mov.rowCount) { console.log(`  ${m.enr}: ya movida (o edicion inesperada)`); continue }
    await q(
      `INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
       VALUES ($1,'edition_reprogrammed',9,$2,$3,'RP de aula hija SEG (import hoja FICO PY-PZ-04)')`,
      [m.enr, 'Hoja FICO: "SE RP 2DO Y 3ER MOD" - la FI de la hoja es la edicion destino',
        JSON.stringify({ old_edition_id: m.de, new_edition_id: m.a, curso: m.curso, parent_enrollment_id: 17017 })])
    console.log(`  ${m.enr}: ${m.curso}`)
  }

  const fechas = await q(
    `UPDATE enrollments SET registration_date = $1
      WHERE enrollment_id IN (17017,17018,17019,17020) AND registration_date::date <> $1 RETURNING enrollment_id`, [F_REGISTRO])

  await q('COMMIT')
  console.log(`reserva reagendada: ${reserva.rowCount} | registration_date corregida: ${fechas.rowCount}`)
} catch (e) { await q('ROLLBACK'); throw e }

console.table((await q(`
  SELECT e.enrollment_id, pe.global_code, pv.abbreviation, pe.start_date::date inicio,
         e.cat_type_status, e.registration_date::date reg, e.total_amount
    FROM enrollments e LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
   WHERE e.enrollment_id = 17017 OR e.parent_enrollment_id = 17017 ORDER BY 1`)).rows)
console.table((await q(`
  SELECT installment_number n, amount, due_date::date vence, cat_status
    FROM payment_installments WHERE enrollment_id = 17017 ORDER BY 1`)).rows)
const s = (await q(`
  SELECT sum(amount) plan, (SELECT total_amount FROM enrollments WHERE enrollment_id=17017) total,
         sum(amount) FILTER (WHERE cat_status IN (4454,2471)) pagado
    FROM payment_installments WHERE enrollment_id=17017`)).rows[0]
console.log('sanity:', s, Number(s.plan) === Number(s.total) ? 'OK' : '<< NO CUADRA')
cli.release()
await pool.end()
