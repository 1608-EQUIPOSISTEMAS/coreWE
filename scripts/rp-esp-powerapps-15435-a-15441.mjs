// RP de las 2 ventas de la ESP. POWER APPS Y AUT. E23 (edicion 15435, 12/09)
// hacia la E24 (edicion 15441, 20/09). La E23 quedo cancelada (A5 + active='N')
// pero nadie movio las inscripciones: sus 4 hijos seguian inflando el AULA de
// POWER APPS E28 (15101) y AVANZADO E22 (15139).
//
// Corre el caso de uso REAL (reprogramEdition), no UPDATEs sueltos: solo asi se
// crean los hijos SEG del arbol nuevo, se desinscribe Odoo del aula vieja y sale
// el correo. Requiere el tunel SSH abierto (Backend/.env ya apunta ahi).
//
// Idempotente: si el origen ya esta en RP, lo saltea.
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
// El bootstrap NO es opcional: cablea el puerto logAudit, que sin el es un no-op
// silencioso (enrollment.repository.js:26) y el RP corre sin dejar bitacora.
import '../src/modules/fico/fico.bootstrap.js'
import { pool } from '../src/config/db.js'
import { reprogramEdition } from '../src/modules/fico/enrollment/enrollment.usecases.js'

const ORIGENES = [13604, 13647]
const EDICION_DESTINO = 15441
const USER_ID = 9 // ADMIN
const JUSTIFICACION =
  'Edicion ESP. POWER APPS Y AUT. E23 (12/09) cancelada (A5). Producto reubica ' +
  'las ventas en la E24 (20/09). Reprogramacion aplicada desde script tras ' +
  'verificar que ningun alumno fue movido y que no hay venta duplicada en la E24.'

const q = (text, params) => pool.query(text, params)

const dump = async () => {
  const enrollments = await q(`
    SELECT e.* FROM public.enrollments e
     WHERE e.enrollment_id = ANY($1::int[]) OR e.parent_enrollment_id = ANY($1::int[])
     ORDER BY COALESCE(e.parent_enrollment_id, e.enrollment_id), e.enrollment_id`, [ORIGENES])
  const ids = enrollments.rows.map(r => r.enrollment_id)
  const cuotas = await q('SELECT * FROM public.payment_installments WHERE enrollment_id = ANY($1::int[])', [ids])
  const pagos = await q('SELECT * FROM public.payments WHERE enrollment_id = ANY($1::int[])', [ids])
  return { enrollments: enrollments.rows, cuotas: cuotas.rows, pagos: pagos.rows }
}

const estadoDe = async (enrollmentId) => {
  const { rows } = await q(`
    SELECT cts.alias FROM public.enrollments e
      LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
     WHERE e.enrollment_id = $1`, [enrollmentId])
  return rows[0]?.alias || null
}

// ── 1. Respaldo antes de tocar nada ──────────────────────────────────────
const backup = await dump()
const ruta = new URL('./_backup_rp_esp_powerapps_15435.json', import.meta.url)
writeFileSync(ruta, JSON.stringify(backup, null, 2))
console.log(`Respaldo: ${backup.enrollments.length} enrollments, ${backup.cuotas.length} cuotas, ${backup.pagos.length} pagos -> _backup_rp_esp_powerapps_15435.json`)

// ── 2. RP por inscripcion ────────────────────────────────────────────────
for (const enrollmentId of ORIGENES) {
  const estado = await estadoDe(enrollmentId)
  if (estado === 'we_enrollment_status_reprogrammed') {
    console.log(`#${enrollmentId}: ya esta en RP, se saltea`)
    continue
  }
  console.log(`\n#${enrollmentId} (${estado}) -> edicion ${EDICION_DESTINO}...`)
  const res = await reprogramEdition({
    enrollmentId,
    newEditionId: EDICION_DESTINO,
    justificacion: JUSTIFICACION,
    userId: USER_ID
  })
  console.log(`  ${res.message} | destino #${res.new_enrollment_id} | job ${res.job_id}`)
}

await pool.end()
process.exit(0)
