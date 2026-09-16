// Censo previo al fix del sync: una Reprogramacion parte la venta en dos filas
// de las hojas FICO (origen RP con lo pagado, destino ACT con lo pendiente).
// Para colapsarlas en una sola fila hay que unir origen <-> destino, y este
// script decide POR DONDE unirlos: audit_logs o enrollments.notes.
import { q, pool } from './db.mjs'

const { rows: [{ db }] } = await q('SELECT current_database() AS db')
console.log('BD:', db, '\n')

// --- 1. Que deja el flujo RP en audit_logs (caso conocido 18939 -> 18956) ----
// El flujo FICO audita en enrollment_audit_log (changes jsonb), no en audit_logs.
const { rows: cols } = await q(
  `SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'enrollment_audit_log'
    ORDER BY ordinal_position`
)
console.log('enrollment_audit_log:', cols.map((c) => c.column_name).join(', '), '\n')

const { rows: huella } = await q(
  `SELECT * FROM public.enrollment_audit_log
    WHERE enrollment_id IN (18939, 18956)
    LIMIT 20`
)
console.log('== AUDIT del caso Bellido ==')
for (const r of huella) console.log(JSON.stringify(r).slice(0, 600))

// --- 2. Universo de RP: cuantos origenes hay y cuantos destinos se hallan ----
const RP = `(SELECT catalog_id FROM public."catalog" WHERE alias = 'we_enrollment_status_reprogrammed')`

const { rows: [censo] } = await q(`
  SELECT
    (SELECT COUNT(*) FROM public.enrollments e
      WHERE e.cat_type_status = ${RP} AND e.active = 'Y')                     AS origenes_rp,
    (SELECT COUNT(*) FROM public.enrollments e
      JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
     WHERE e.cat_type_status = ${RP} AND e.active = 'Y'
       AND cf.alias = 'we_enrollment_status_checked')                         AS origenes_rp_en_hoja,
    (SELECT COUNT(*) FROM public.enrollments d
      WHERE d.notes LIKE 'Reprogramacion desde inscripcion #%')               AS destinos_por_notes,
    (SELECT COUNT(*) FROM public.enrollment_audit_log a
      WHERE a.action = 'edition_reprogrammed')                                AS audits_rp,
    (SELECT COUNT(*) FROM public.enrollment_audit_log a
      WHERE a.action = 'edition_reprogrammed'
        AND a.changes->>'new_enrollment_id' IS NOT NULL)                      AS audits_rp_con_destino
`)
console.log('\n== CENSO ==')
console.table([censo])

// --- 3. Los pares que se pueden armar por notes, con sus montos partidos -----
const { rows: pares } = await q(`
  WITH destino AS (
    SELECT d.enrollment_id AS destino_id,
           NULLIF(substring(d.notes FROM 'inscripcion #([0-9]+)'), '')::int AS origen_id
      FROM public.enrollments d
     WHERE d.notes LIKE 'Reprogramacion desde inscripcion #%'
       AND d.active = 'Y'
  )
  SELECT t.origen_id, t.destino_id,
         co.alias AS estado_origen,
         (SELECT COALESCE(SUM(pi.amount), 0) FROM public.payment_installments pi
           WHERE pi.enrollment_id = t.origen_id)   AS monto_origen,
         (SELECT COALESCE(SUM(pi.amount), 0) FROM public.payment_installments pi
           WHERE pi.enrollment_id = t.destino_id)  AS monto_destino,
         o.total_amount AS total_pactado_origen
    FROM destino t
    LEFT JOIN public.enrollments o  ON o.enrollment_id = t.origen_id
    LEFT JOIN public."catalog" co   ON co.catalog_id = o.cat_type_status
   ORDER BY t.destino_id DESC
   LIMIT 40
`)
console.log('\n== PARES RP (por notes) ==')
console.table(pares)

const huerfanos = pares.filter((p) => !p.estado_origen)
console.log('destinos cuyo origen no existe:', huerfanos.length)
const noRP = pares.filter((p) => p.estado_origen && p.estado_origen !== 'we_enrollment_status_reprogrammed')
console.log('destinos cuyo origen NO esta en RP:', noRP.length, noRP.map((p) => `${p.origen_id}:${p.estado_origen}`).join(', '))

await pool.end()
