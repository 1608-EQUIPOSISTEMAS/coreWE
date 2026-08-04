// Backfill: inscripciones al V CONGRESO DE DIRECCION creadas desde FICO antes
// de que el formulario pidiera la categoria de entrada (quedaron en NULL).
//
// Sin categoria el correo de confirmacion sale sin el grupo de WhatsApp propio
// del tier y con el detalle de sesiones que toque por fallback.
//
// Uso:  node scripts/backfill-congreso-cat-event.mjs 5069 15805 15807
//       (5069 = VIP, 5070 = GENERAL, 5067 = VIRTUAL, 5068 = PREMIUM)
//
// Idempotente: solo pisa filas con cat_event_category IS NULL.
import { q, pool } from './db.mjs'

const [catId, ...ids] = process.argv.slice(2)
if (!catId || !ids.length) {
  console.error('Uso: node scripts/backfill-congreso-cat-event.mjs <cat_event_category> <enrollment_id...>')
  process.exit(1)
}

const { rows } = await q(
  `UPDATE public.enrollments
      SET cat_event_category = $1
    WHERE enrollment_id = ANY($2::int[])
      AND cat_event_category IS NULL
  RETURNING enrollment_id, cat_event_category`,
  [Number(catId), ids.map(Number)]
)
console.log(`Actualizadas ${rows.length} inscripcion(es):`)
console.table(rows)
await pool.end()
