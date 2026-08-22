// Backfill de asientos VIP: FICO los anota a mano en enrollments.notes
// ("ASIENTO N° 12") cuando la inscripcion se creo antes de que el formulario
// pidiera el asiento, y el correo de confirmacion los lee de event_seat.
//
// Uso:  node scripts/set-event-seat.mjs 14930=12 14933=67
//
// Solo escribe entradas VIP (el correo omite el asiento en cualquier otra
// categoria) y es idempotente: repetirlo deja el mismo valor.
import { q, pool } from './db.mjs'

const VIP = 5069

const pares = process.argv.slice(2).map((arg) => arg.split('='))
if (!pares.length || pares.some(([id, seat]) => !id || !seat)) {
  console.error('Uso: node scripts/set-event-seat.mjs <enrollment_id>=<asiento> ...')
  process.exit(1)
}

for (const [id, seat] of pares) {
  const { rows } = await q(
    `UPDATE public.enrollments
        SET event_seat = $2
      WHERE enrollment_id = $1
        AND cat_event_category = ${VIP}
    RETURNING enrollment_id, cat_event_category, event_seat, notes`,
    [Number(id), seat.trim()]
  )
  if (!rows.length) console.error(`enrollment ${id}: sin cambios (no existe o no es VIP)`)
  else console.table(rows)
}

await pool.end()
