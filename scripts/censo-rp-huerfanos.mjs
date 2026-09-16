// Tercer censo RP. Dos preguntas abiertas que deciden el diseño del fix:
//
//   A) Los 29 origenes RP sin destino hallable, ¿no TIENEN destino (marcados RP
//      a mano / por import) o si lo tienen y el vinculo se perdio? Si es lo
//      segundo, el fallback "dejalo pasar" no alcanza y hace falta matchear por
//      alumno+programa.
//   B) Los origenes con dos destinos (14884, 3585), ¿son la misma RP ejecutada
//      dos veces? Eso es un bug de datos aparte del sync: doble asiento en aula.
//
// Y de paso el tamaño del daño actual: cuantos destinos RP estan hoy con
// total_amount = 0, que es lo que hace al Consolidado decir "BECA" y "Saldado".
import { q, pool } from './db.mjs'

const { rows: [{ db }] } = await q('SELECT current_database() AS db')
console.log('BD:', db, '\n')

const LINK = `
  WITH link AS (
    SELECT DISTINCT
           a.enrollment_id                        AS origen_id,
           (a.changes->>'new_enrollment_id')::int AS destino_id
      FROM public.enrollment_audit_log a
     WHERE a.action = 'edition_reprogrammed'
       AND a.changes->>'new_enrollment_id' ~ '^[0-9]+$'
    UNION
    SELECT substring(a.changes->'Enrollment origen'->>'new' FROM '#([0-9]+)')::int,
           a.enrollment_id
      FROM public.enrollment_audit_log a
     WHERE a.action = 'created_from_rp'
       AND a.changes->'Enrollment origen'->>'new' ~ '#[0-9]+'
    UNION
    SELECT substring(d.notes FROM 'inscripcion #([0-9]+)')::int,
           d.enrollment_id
      FROM public.enrollments d
     WHERE d.notes LIKE 'Reprogramacion desde inscripcion #%'
  ),
  rp AS (
    SELECT e.enrollment_id, e.customer_id, pv.program_id, e.registration_date
      FROM public.enrollments e
      JOIN public."catalog" c ON c.catalog_id = e.cat_type_status
      LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
     WHERE c.alias = 'we_enrollment_status_reprogrammed' AND e.active = 'Y'
  ),
  huerfano AS (
    SELECT * FROM rp
     WHERE enrollment_id NOT IN (SELECT origen_id FROM link WHERE origen_id IS NOT NULL)
  )`

// --- A) ¿los huerfanos tienen algun candidato a destino? --------------------
// Candidato = otra inscripcion del MISMO alumno y MISMO programa, posterior.
// Si esto sale vacio, el origen quedo RP sin reprogramacion real detras.
const { rows: candidatos } = await q(`${LINK}
  SELECT h.enrollment_id AS huerfano,
         COALESCE(cand.n, 0) AS candidatos,
         cand.detalle
    FROM huerfano h
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS n,
             string_agg(d.enrollment_id::text || ':' || COALESCE(cd.alias, '?'), ', ') AS detalle
        FROM public.enrollments d
        JOIN public.program_versions pvd ON pvd.program_version_id = d.program_version_id
        LEFT JOIN public."catalog" cd    ON cd.catalog_id = d.cat_type_status
       WHERE d.customer_id = h.customer_id
         AND pvd.program_id = h.program_id
         AND d.enrollment_id <> h.enrollment_id
         AND d.active = 'Y'
         AND d.registration_date >= h.registration_date
    ) cand ON TRUE
   ORDER BY 2 DESC, 1
`)
console.log(`== A) HUERFANOS Y SUS CANDIDATOS A DESTINO (${candidatos.length}) ==`)
console.table(candidatos.slice(0, 35))
console.log('huerfanos SIN ningun candidato:', candidatos.filter((c) => Number(c.candidatos) === 0).length)
console.log('huerfanos CON candidato:', candidatos.filter((c) => Number(c.candidatos) > 0).length)

// --- B) los dos destinos: ¿RP repetida? -------------------------------------
const { rows: dobles } = await q(`
  SELECT e.enrollment_id, e.parent_enrollment_id, c.alias AS estado, e.active,
         e.customer_id, e.program_edition_id, e.total_amount, e.registration_date,
         (SELECT COUNT(*) FROM public.payment_installments pi
           WHERE pi.enrollment_id = e.enrollment_id) AS cuotas,
         (SELECT COUNT(*) FROM public.payments p
           WHERE p.enrollment_id = e.enrollment_id AND p.active = 'Y') AS pagos,
         e.odoo_user_id, e.odoo_order_id
    FROM public.enrollments e
    LEFT JOIN public."catalog" c ON c.catalog_id = e.cat_type_status
   WHERE e.enrollment_id IN (3585, 15997, 16001, 14884, 18922, 18923)
   ORDER BY e.customer_id, e.enrollment_id
`)
console.log('\n== B) ORIGENES CON DOS DESTINOS ==')
console.table(dobles)

// --- Tamaño del daño: destinos RP vivos con total_amount = 0 ----------------
const { rows: [danio] } = await q(`${LINK}
  SELECT
    COUNT(*) FILTER (WHERE e.active = 'Y')                          AS destinos_vivos,
    COUNT(*) FILTER (WHERE e.active = 'Y' AND e.total_amount = 0)   AS destinos_en_cero,
    COUNT(*) FILTER (WHERE e.active = 'Y' AND cf.alias = 'we_enrollment_status_checked') AS destinos_en_hoja
    FROM (SELECT DISTINCT destino_id FROM link WHERE destino_id IS NOT NULL) t
    JOIN public.enrollments e   ON e.enrollment_id = t.destino_id
    LEFT JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
`)
console.log('\n== TAMAÑO DEL DAÑO (destinos RP) ==')
console.table([danio])

await pool.end()
