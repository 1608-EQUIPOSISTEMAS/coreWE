// Segundo censo RP: decide COMO unir origen y destino antes de tocar el sync.
//
// Hay tres fuentes posibles del vinculo y ninguna cubre sola las 112 RP:
//   1. audit del ORIGEN  (edition_reprogrammed) -> changes->>'new_enrollment_id', entero limpio
//   2. audit del DESTINO (created_from_rp)      -> changes->'Enrollment origen'->>'new' = "#18939"
//   3. notes del DESTINO                        -> 'Reprogramacion desde inscripcion #18939'
//
// Lo que este script tiene que contestar:
//   a) cuanta cobertura da la UNION de las tres (y cuantos origenes quedan huerfanos)
//   b) si hay cadenas A->B->C o origenes con varios destinos (14884 -> 18922 y 18923)
import { q, pool } from './db.mjs'

const { rows: [{ db }] } = await q('SELECT current_database() AS db')
console.log('BD:', db, '\n')

const LINK = `
  WITH link AS (
    SELECT a.enrollment_id                              AS origen_id,
           (a.changes->>'new_enrollment_id')::int       AS destino_id,
           'audit_origen'                               AS fuente
      FROM public.enrollment_audit_log a
     WHERE a.action = 'edition_reprogrammed'
       AND a.changes->>'new_enrollment_id' ~ '^[0-9]+$'
    UNION
    SELECT substring(a.changes->'Enrollment origen'->>'new' FROM '#([0-9]+)')::int,
           a.enrollment_id,
           'audit_destino'
      FROM public.enrollment_audit_log a
     WHERE a.action = 'created_from_rp'
       AND a.changes->'Enrollment origen'->>'new' ~ '#[0-9]+'
    UNION
    SELECT substring(d.notes FROM 'inscripcion #([0-9]+)')::int,
           d.enrollment_id,
           'notes'
      FROM public.enrollments d
     WHERE d.notes LIKE 'Reprogramacion desde inscripcion #%'
  ),
  rp AS (
    SELECT e.enrollment_id
      FROM public.enrollments e
      JOIN public."catalog" c ON c.catalog_id = e.cat_type_status
     WHERE c.alias = 'we_enrollment_status_reprogrammed' AND e.active = 'Y'
  )`

// --- a) cobertura por fuente y de la union ----------------------------------
const { rows: cobertura } = await q(`${LINK}
  SELECT fuente, COUNT(DISTINCT origen_id) AS origenes_cubiertos
    FROM link WHERE origen_id IN (SELECT enrollment_id FROM rp)
   GROUP BY fuente
   UNION ALL
  SELECT 'UNION', COUNT(DISTINCT origen_id)
    FROM link WHERE origen_id IN (SELECT enrollment_id FROM rp)
   UNION ALL
  SELECT 'TOTAL origenes RP', COUNT(*) FROM rp
`)
console.log('== COBERTURA DEL VINCULO ==')
console.table(cobertura)

// Los huerfanos NO se pueden excluir de la hoja: sin destino, sacarlos borraria
// la venta. El fix tiene que dejarlos pasar tal como estan hoy.
const { rows: huerfanos } = await q(`${LINK}
  SELECT r.enrollment_id AS origen_sin_destino,
         e.total_amount,
         (SELECT COALESCE(SUM(pi.amount), 0) FROM public.payment_installments pi
           WHERE pi.enrollment_id = r.enrollment_id) AS monto_cuotas,
         e.registration_date::date
    FROM rp r
    JOIN public.enrollments e ON e.enrollment_id = r.enrollment_id
   WHERE r.enrollment_id NOT IN (SELECT origen_id FROM link WHERE origen_id IS NOT NULL)
   ORDER BY e.registration_date DESC
`)
console.log(`\n== ORIGENES RP SIN DESTINO HALLABLE (${huerfanos.length}) ==`)
console.table(huerfanos.slice(0, 20))

// --- b) cadenas y multiples destinos ----------------------------------------
const { rows: multi } = await q(`${LINK}
  SELECT origen_id,
         COUNT(DISTINCT destino_id)                AS destinos,
         string_agg(DISTINCT destino_id::text, ', ') AS ids,
         string_agg(DISTINCT fuente, ', ')         AS fuentes
    FROM link
   GROUP BY origen_id
  HAVING COUNT(DISTINCT destino_id) > 1
   ORDER BY 2 DESC
`)
console.log(`\n== ORIGENES CON MAS DE UN DESTINO (${multi.length}) ==`)
console.table(multi)

// Una cadena A->B->C: el destino de una RP es a su vez origen de otra.
const { rows: cadenas } = await q(`${LINK}
  SELECT l1.origen_id AS a, l1.destino_id AS b, l2.destino_id AS c
    FROM link l1
    JOIN link l2 ON l2.origen_id = l1.destino_id
   ORDER BY 1
`)
console.log(`\n== CADENAS A->B->C (${cadenas.length}) ==`)
console.table(cadenas)

// El detalle del caso de los dos destinos: ¿RP repetida o hijos de paquete?
const { rows: caso } = await q(`
  SELECT e.enrollment_id, e.parent_enrollment_id, c.alias AS estado, e.active,
         pv.abbreviation AS programa, e.program_edition_id, e.total_amount,
         e.registration_date, left(e.notes, 70) AS notes
    FROM public.enrollments e
    LEFT JOIN public."catalog" c          ON c.catalog_id = e.cat_type_status
    LEFT JOIN public.program_versions pv  ON pv.program_version_id = e.program_version_id
   WHERE e.enrollment_id IN (14884, 18922, 18923)
   ORDER BY e.enrollment_id
`)
console.log('\n== CASO 14884 -> 18922 / 18923 ==')
console.table(caso)

await pool.end()
