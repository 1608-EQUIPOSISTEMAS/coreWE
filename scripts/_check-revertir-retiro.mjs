// Prueba de revertir-retiro.mjs contra la BD local: simula el retiro tal cual lo
// hace retireEnrollment (padre y cada hijo activo -> 3245 + bitacora 'retired'),
// corre la reversion y verifica que todo volvio a su estado original.
// Deja la BD como la encontro. Uso: node scripts/_check-revertir-retiro.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { q, pool } from './db.mjs'

const ID = 1592
const RETIRADO = 3245

const estados = async () => {
  const { rows } = await q(
    `SELECT enrollment_id, cat_type_status FROM enrollments
      WHERE enrollment_id = $1 OR parent_enrollment_id = $1 ORDER BY enrollment_id`, [ID])
  return rows
}

const antes = await estados()
console.log('antes:', antes)
assert.ok(antes.length > 1, 'el caso de prueba necesita hijos')

// Un hijo que YA estaba retirado antes por otro motivo: la reversion no debe
// resucitarlo, aunque su bitacora sea posterior a la del padre.
const yaRetirado = antes.at(-1).enrollment_id
await q('UPDATE enrollments SET cat_type_status = $1 WHERE enrollment_id = $2', [RETIRADO, yaRetirado])
await q(`INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, details)
         VALUES ($1, 'retired', NULL, 'Retirado a pedido del alumno (fixture)')`, [yaRetirado])

// El retiro por error de hoy, en el MISMO orden que retireEnrollment: primero
// cada hijo (con su bitacora), y recien al final la del padre.
await q(`UPDATE enrollments SET cat_type_status = $1
          WHERE parent_enrollment_id = $2 AND cat_type_status <> $1`, [RETIRADO, ID])
await q(`INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, details)
         SELECT enrollment_id, 'retired', NULL,
                'Retirado por retiro del programa padre #' || $1::int || ' (fixture)'
           FROM enrollments WHERE parent_enrollment_id = $1::int AND enrollment_id <> $2`, [ID, yaRetirado])
await q('UPDATE enrollments SET cat_type_status = $1 WHERE enrollment_id = $2', [RETIRADO, ID])
await q(`INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, details)
         VALUES ($1, 'retired', NULL, 'Alumno retirado por error (fixture)')`, [ID])

console.log(execFileSync('node', ['scripts/revertir-retiro.mjs', String(ID), '--aplicar'], { encoding: 'utf8' }))

// La limpieza va en finally: si una asercion falla y la BD queda a medias, la
// corrida siguiente arranca de un estado sucio y el test miente.
try {
  const despues = await estados()
  console.log('despues:', despues)
  for (const fila of despues) {
    const original = antes.find(a => a.enrollment_id === fila.enrollment_id)
    const esperado = fila.enrollment_id === yaRetirado ? RETIRADO : original.cat_type_status
    assert.equal(fila.cat_type_status, esperado, `enrollment ${fila.enrollment_id}`)
  }

  const { rows: bitacora } = await q(
    `SELECT enrollment_id, details FROM enrollment_audit_log
      WHERE action = 'retire_reverted' ORDER BY enrollment_id`)
  console.log('bitacora escrita:', bitacora)
  assert.equal(bitacora.length, despues.length - 1, 'una entrada por el padre y por cada hijo revertido')
  console.log('\nOK: la reversion restaura los estados y respeta al hijo ya retirado.')
} finally {
  await q(`DELETE FROM enrollment_audit_log WHERE details LIKE '%(fixture)%' OR action = 'retire_reverted'`)
  for (const fila of antes) {
    await q('UPDATE enrollments SET cat_type_status = $1 WHERE enrollment_id = $2', [fila.cat_type_status, fila.enrollment_id])
  }
  await pool.end()
}
