// Deshace un retiro que FICO ejecuto por error.
//
// retireEnrollment solo cambia estados: el padre pasa a R (3245) y cada hijo
// activo tambien. Volver atras es devolver al padre su Activo (3100) y a los
// hijos su SEG (3243), que es el unico estado valido de un hijo de paquete.
//
// Lo que el retiro rompe y este script NO puede deshacer (se avisa al final):
//   - Odoo: al alumno lo desinscribieron del aula y le cancelaron la orden de
//     venta. Hay que re-inscribirlo a mano desde la ficha.
//   - Cuotas del padre anuladas (cat_status 4456) y cuotas de los hijos, que el
//     retiro BORRA. El script las lista; no las resucita porque 4456 tambien lo
//     usa la campana de cobranza y no hay forma de distinguirlas.
//
//   node scripts/revertir-retiro.mjs 1592            # plan, no guarda
//   node scripts/revertir-retiro.mjs 1592 --aplicar  # aplica (BD del .env)
//   node scripts/revertir-retiro.mjs 1592 --prod ... # apunta a produccion
import fs from 'node:fs'

const ENROLLMENT_ID = Number(process.argv[2])
if (!Number.isInteger(ENROLLMENT_ID)) throw new Error('Uso: node scripts/revertir-retiro.mjs <enrollment_id> [--aplicar] [--prod]')
const APLICAR = process.argv.includes('--aplicar')
if (process.argv.includes('--prod')) await import('./_prod.mjs')
const { q, pool } = await import('./db.mjs')

const RETIRADO = 3245
const ACTIVO = 3100
const SEG = 3243
const ANULADA = 4456
const ALIAS_AUTOR = 'ADMIN'
const JUSTIFICACION = 'Retiro revertido: FICO retiro al alumno por error. La inscripcion vuelve a su estado normal.'

const { rows: [venta] } = await q(`
  SELECT e.enrollment_id, e.parent_enrollment_id, e.cat_type_status,
         CONCAT(per.first_name, ' ', per.last_name) AS alumno,
         pv.abbreviation AS programa, ed.global_code AS edicion
    FROM enrollments e
    JOIN customers c ON c.customer_id = e.customer_id
    JOIN persons per ON per.person_id = c.person_id
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN program_editions ed ON ed.edition_num_id = e.program_edition_id
   WHERE e.enrollment_id = $1`, [ENROLLMENT_ID])

if (!venta) throw new Error(`No existe la inscripcion ${ENROLLMENT_ID}`)
if (venta.cat_type_status !== RETIRADO) throw new Error(`La inscripcion ${ENROLLMENT_ID} no esta retirada (cat_type_status=${venta.cat_type_status}). Nada que revertir.`)

// Un hijo de paquete siempre vuelve a SEG; una venta raiz, a Activo.
const estadoDestino = venta.parent_enrollment_id ? SEG : ACTIVO
console.log(`Inscripcion ${ENROLLMENT_ID} | ${venta.alumno} | ${venta.programa || '---'} ${venta.edicion || ''}`)

const { rows: [retiro] } = await q(`
  SELECT audit_id, performed_at FROM enrollment_audit_log
   WHERE enrollment_id = $1 AND action = 'retired'
   ORDER BY performed_at DESC LIMIT 1`, [ENROLLMENT_ID])
console.log(`Retiro a revertir: ${retiro ? retiro.performed_at.toISOString() : 'sin rastro en la bitacora'}`)

// Solo los hijos que retiro ESTE retiro. La marca no es la hora (retireChild
// audita a los hijos ANTES de auditar al padre, asi que comparar timestamps los
// descarta a todos) sino el texto que el propio retiro escribe en la bitacora:
// "Retirado por retiro del programa padre #<id>". Un modulo que ya estaba en R
// por otro motivo no lo dice, y por eso no se resucita.
const { rows: hijos } = await q(`
  SELECT h.enrollment_id, pv.abbreviation AS programa, ed.global_code AS edicion,
         (SELECT al.details FROM enrollment_audit_log al
           WHERE al.enrollment_id = h.enrollment_id AND al.action = 'retired'
           ORDER BY al.performed_at DESC LIMIT 1) AS motivo_retiro
    FROM enrollments h
    LEFT JOIN program_versions pv ON pv.program_version_id = h.program_version_id
    LEFT JOIN program_editions ed ON ed.edition_num_id = h.program_edition_id
   WHERE h.parent_enrollment_id = $1 AND h.cat_type_status = $2
   ORDER BY h.enrollment_id`, [ENROLLMENT_ID, RETIRADO])

const esDeEsteRetiro = h => (h.motivo_retiro || '').includes(`padre #${ENROLLMENT_ID}`)
const aRevertir = hijos.filter(esDeEsteRetiro)
const etiqueta = h => `#${h.enrollment_id} ${h.programa || ''} ${h.edicion || ''}`.trim()
console.log(`Hijos a devolver a SEG: ${aRevertir.length ? aRevertir.map(etiqueta).join(' | ') : 'ninguno'}`)

const ajenos = hijos.filter(h => !esDeEsteRetiro(h))
if (ajenos.length) {
  console.log(`Hijos que se dejan en R (retirados por otro motivo): ${ajenos.map(h => `${etiqueta(h)} → ${h.motivo_retiro || 'sin bitacora'}`).join(' | ')}`)
}

const { rows: cuotas } = await q(`
  SELECT installment_id, installment_number, amount, due_date FROM payment_installments
   WHERE enrollment_id = $1 AND cat_status = $2 ORDER BY installment_number`, [ENROLLMENT_ID, ANULADA])

const { rows: [autor] } = await q(
  'SELECT user_id, alias FROM users WHERE alias = $1 AND active = $2 LIMIT 1', [ALIAS_AUTOR, 'Y'])
if (!autor) throw new Error(`No existe el usuario ${ALIAS_AUTOR}: la bitacora quedaria sin autor.`)

const changes = {
  Estado: { old: 'Retirado', new: estadoDestino === SEG ? 'SEG' : 'Activo' },
  Motivo: { old: '---', new: 'Retiro por error de FICO' }
}
if (aRevertir.length) {
  changes['Modulos reactivados'] = { old: '---', new: aRevertir.map(h => `${h.programa || ''} ${h.edicion || ''}`.trim()).join(', ') }
}
const details = `Retiro revertido: la inscripcion vuelve a ${changes.Estado.new}. El retiro se habia hecho por error de FICO.${aRevertir.length ? ` ${aRevertir.length} modulo(s) hijo(s) devuelto(s) a SEG.` : ''}`

if (!APLICAR) {
  console.log(`\nBitacora: ${details}`)
  if (cuotas.length) console.table(cuotas)
  console.log('\n--aplicar para guardar. Ahora no se guardo nada.')
  await pool.end()
  process.exit(0)
}

fs.writeFileSync(
  new URL(`./_backup_retiro_${ENROLLMENT_ID}.json`, import.meta.url),
  JSON.stringify({ venta, retiro, hijos: aRevertir, cuotasAnuladas: cuotas, ts: new Date().toISOString() }, null, 2)
)

const cliente = await pool.connect()
try {
  await cliente.query('BEGIN')
  // Compare-and-swap contra 3245: si alguien ya movio el estado, aborta.
  const { rowCount } = await cliente.query(`
    UPDATE enrollments SET cat_type_status = $1, user_modification_id = $2, modification_date = NOW()
     WHERE enrollment_id = $3 AND cat_type_status = $4`,
  [estadoDestino, autor.user_id, ENROLLMENT_ID, RETIRADO])
  if (rowCount !== 1) throw new Error(`El UPDATE del padre toco ${rowCount} filas: alguien movio el estado, aborto.`)

  for (const hijo of aRevertir) {
    await cliente.query(
      'UPDATE enrollments SET cat_type_status = $1 WHERE enrollment_id = $2 AND cat_type_status = $3',
      [SEG, hijo.enrollment_id, RETIRADO])
    await cliente.query(`
      INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, details)
      VALUES ($1, 'retire_reverted', $2, $3, $4)`,
    [hijo.enrollment_id, autor.user_id, JUSTIFICACION,
      `Devuelto a SEG al revertirse el retiro del programa padre #${ENROLLMENT_ID}`])
  }

  await cliente.query(`
    INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
    VALUES ($1, 'retire_reverted', $2, $3, $4::jsonb, $5)`,
  [ENROLLMENT_ID, autor.user_id, JUSTIFICACION, JSON.stringify(changes), details])

  await cliente.query('COMMIT')
} catch (err) {
  await cliente.query('ROLLBACK')
  throw err
} finally {
  cliente.release()
}
console.log('OK: estados restaurados y bitacora escrita.')

// El panel de FICO lee la cabecera de la matview, no de la tabla.
await q('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_enrollment_report_system')
  .catch(() => q('REFRESH MATERIALIZED VIEW mv_enrollment_report_system'))
console.log('Matview mv_enrollment_report_system refrescada.')

console.log('\nPENDIENTE A MANO (el retiro lo hizo, el script no lo deshace):')
console.log(' - Odoo: re-inscribir al alumno en el aula y revisar la orden de venta cancelada.')
if (cuotas.length) {
  console.log(` - ${cuotas.length} cuota(s) del padre siguen anuladas (4456); revisar y reactivar a mano:`)
  console.table(cuotas)
} else {
  console.log(' - Sin cuotas anuladas pendientes de revisar.')
}

await pool.end()
