// Deshace un "Rechazar" dado por error en Reprogramaciones: devuelve el caso a
// 'contactado' para que el boton Veredicto se vuelva a habilitar.
//
// Es seguro porque rechazar NO ejecuta nada (rejectCase solo escribe el status):
// no hay enrollment nuevo, ni cuotas movidas, ni Odoo que revertir. Por eso la
// guarda exige status = 'rechazado'; un caso aceptado SI movio al alumno y no se
// reabre asi.
//
// Uso (desde Backend/): node scripts/reabrir-veredicto-reprogram.mjs <enrollment_id>
import { q, pool } from './db.mjs'

const enrollmentId = Number(process.argv[2])
if (!enrollmentId) throw new Error('Uso: node scripts/reabrir-veredicto-reprogram.mjs <enrollment_id>')

const { rows: [db] } = await q('SELECT current_database() AS db')
console.log('BD:', db.db)

const { rows } = await q(`
  UPDATE public.reprogram_cases
     SET status = 'contactado',
         verdict_by = NULL, verdict_at = NULL, verdict_notes = NULL,
         pending_steps = '[]'::jsonb, modification_date = now()
   WHERE enrollment_id = $1 AND active = 'Y' AND status = 'rechazado'
  RETURNING reprogram_case_id, enrollment_id, status, dest_kind, contacted_at, verdict_by`,
[enrollmentId])

console.log(rows.length ? rows : 'Nada que reabrir: el caso no existe o no esta rechazado')
await pool.end()
