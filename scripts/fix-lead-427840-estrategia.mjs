// One-off 14/08/26: el lead 427840 (enrollment 16375, V CONGRESO DE DIRECCION)
// se registro sin Estrategia por error del asesor. Sin ese campo, el CASE de
// area de Fundacion > Objetivos lo mandaba a "1.6 Otros" en vez de "1.1
// Comercial" (ver AREA_CASE en edition.repository.js).
//
// Se le pone la misma estrategia que su gemelo 428726 / enrollment 16376:
// Referidos Organicos (catalog 3132).
//
// Guarda idempotente: solo escribe si sigue en NULL, asi correrlo dos veces no
// pisa una correccion posterior hecha desde el modulo de Comercial.
import { q, pool } from './db.mjs'

const LEAD_ID = 427840
const REFERIDOS_ORGANICOS = 3132

const { rows } = await q(
  `UPDATE public.leads
      SET cat_type_strategy = $2
    WHERE lead_id = $1 AND cat_type_strategy IS NULL
    RETURNING lead_id, enrollment_id, cat_type_strategy`,
  [LEAD_ID, REFERIDOS_ORGANICOS]
)

console.log(rows.length ? 'Actualizado:' : 'Sin cambios (ya tenia estrategia):', rows)

const { rows: check } = await q(
  `SELECT l.lead_id, l.enrollment_id, s.description AS estrategia,
          c.description AS entrada
     FROM public.leads l
     LEFT JOIN public.catalog s ON s.catalog_id = l.cat_type_strategy
     LEFT JOIN public.enrollments e ON e.enrollment_id = l.enrollment_id
     LEFT JOIN public.catalog c ON c.catalog_id = e.cat_event_category
    WHERE l.lead_id = $1`,
  [LEAD_ID]
)
console.table(check)

await pool.end()
