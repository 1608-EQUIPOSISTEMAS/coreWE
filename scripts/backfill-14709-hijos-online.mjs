// Backfill de los 3 hijos SEG de 14709 (ESP. EN ANALISIS DE DATOS, online sin
// ediciones). Ejecuta el CODIGO REAL ya corregido (createChildEnrollments), no
// INSERTs a mano, para que el backfill valide de paso la rama nueva.
//
// Odoo y correo quedan cableados a puertos que ABORTAN: con el fix isE0=false,
// asi que no deben dispararse; si se disparan, se ve en consola y no sale nada.
import fs from 'node:fs'

// El pool de la app lee DATABASE_URL (apunta al host directo, bloqueado). Se
// reescribe al tunel ANTES de importar nada que cargue dotenv/db.js.
const envTxt = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const orig = envTxt.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim()
if (!orig) throw new Error('No se encontro DATABASE_URL en Backend/.env')
const u = new URL(orig)
u.hostname = '127.0.0.1'
u.port = '55432'
u.search = ''
process.env.DATABASE_URL = u.toString()
process.env.DATABASE_SSL = 'false'

const EID = 14709
const USER = 22

const { pool } = await import('../src/config/db.js')
const { setPorts, createChildEnrollments } = await import('../src/modules/fico/validation/validation.usecases.js')

setPorts({
  logAudit: async ({ enrollmentId, action, userId, details }) => {
    await pool.query(
      'insert into enrollment_audit_log (enrollment_id, action, performed_by, details) values ($1,$2,$3,$4)',
      [enrollmentId, action, userId ?? USER, details ?? null])
  },
  enrollInOdoo: async () => { throw new Error('ABORTADO: el backfill no debe tocar Odoo (isE0 deberia ser false)') },
  sendConfirmationEmail: async () => { throw new Error('ABORTADO: el backfill no debe enviar correos (isE0 deberia ser false)') }
})

try {
  const antes = await pool.query('select enrollment_id from enrollments where parent_enrollment_id=$1', [EID])
  if (antes.rowCount > 0) {
    console.log('El enrollment ' + EID + ' ya tiene ' + antes.rowCount + ' hijo(s); no se hace nada.')
    console.table(antes.rows)
  } else {
    const padre = (await pool.query('select customer_id, program_version_id, program_edition_id from enrollments where enrollment_id=$1', [EID])).rows[0]
    console.log('padre:', padre)
    if (padre.customer_id !== 18331) throw new Error('El padre no esta en el customer correcto (18331): corre antes fix-14709-cc-alumno-duplicado.mjs')

    const res = await createChildEnrollments({ enrollmentId: EID, userId: USER })
    console.log('\nresultado:', JSON.stringify(res, null, 2))
    if (res.isE0) throw new Error('isE0 salio true: no esperado para un paquete online')
    if (res.createdChildren.length !== 3) throw new Error('Se esperaban 3 hijos, se crearon ' + res.createdChildren.length)
  }

  const { rows } = await pool.query(
    'select h.enrollment_id, h.program_version_id, pv.abbreviation, h.program_edition_id, h.cat_type_status, ' +
    '       h.cat_payment_plan, h.total_amount, h.list_price, h.discount_amount, h.customer_id, h.cat_fico_status, h.notes ' +
    'from enrollments h left join program_versions pv on pv.program_version_id=h.program_version_id ' +
    'where h.parent_enrollment_id=$1 order by h.enrollment_id', [EID])
  console.log('\n=== HIJOS de ' + EID + ' ===')
  console.table(rows)

  // Invariante: hijo = SEG (3243) + Al contado (2466) + total 0 + edicion NULL.
  for (const h of rows) {
    if (h.cat_type_status !== 3243) throw new Error('hijo ' + h.enrollment_id + ' no es SEG')
    if (h.cat_payment_plan !== 2466) throw new Error('hijo ' + h.enrollment_id + ' no es Al contado')
    if (Number(h.total_amount) !== 0) throw new Error('hijo ' + h.enrollment_id + ' con total != 0')
    if (h.program_edition_id !== null) throw new Error('hijo ' + h.enrollment_id + ' deberia tener edicion NULL')
    if (h.customer_id !== 18331) throw new Error('hijo ' + h.enrollment_id + ' colgado del customer equivocado')
  }
  console.log('\nInvariante OK: 3 hijos SEG + Al contado + total 0 + edicion NULL + customer 18331')

  await pool.query('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')
  console.log('MV refrescada')
} catch (e) {
  console.error('\n!!! ERROR:', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
