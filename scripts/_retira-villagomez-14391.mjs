// Retiro de DIEGO RAUL VILLAGOMEZ (enr 14391, E17, importado el 2026-07-24).
// La hoja lo trae con ESTADO ALUMNO = R y la observación "Se R. porque escogio
// otra Area". Convención del sistema: padre e hijos pasan a R (3245) y queda un
// audit log 'retired'. Idempotente: solo toca los que aún no están en R.
import { q, pool } from './db.mjs'

const PADRE = 14391
const RETIRADO = 3245
const USER_ID = 9 // ADMIN

const { rows } = await q(
  'SELECT enrollment_id, cat_type_status FROM public.enrollments WHERE enrollment_id = $1 OR parent_enrollment_id = $1 ORDER BY enrollment_id',
  [PADRE])

for (const e of rows) {
  if (Number(e.cat_type_status) === RETIRADO) { console.log(`${e.enrollment_id}: ya estaba en R`); continue }
  await q('UPDATE public.enrollments SET cat_type_status = $1, user_modification_id = $2, modification_date = now() WHERE enrollment_id = $3',
    [RETIRADO, USER_ID, e.enrollment_id])
  await q(`INSERT INTO public.enrollment_audit_log (enrollment_id, action, performed_by, performed_at, justificacion, details)
           VALUES ($1, 'retired', $2, now(), $3, $4)`,
  [e.enrollment_id, USER_ID, 'Se R. porque escogio otra Area',
    e.enrollment_id === PADRE
      ? 'Retirado segun la hoja FICO (ESTADO ALUMNO = R) al importar la especializacion SAP HANA'
      : `Retirado junto con su programa padre #${PADRE}`])
  console.log(`${e.enrollment_id}: -> R`)
}

await q('REFRESH MATERIALIZED VIEW public.mv_enrollment_report_system')
console.log('matview refrescada')
await pool.end()
