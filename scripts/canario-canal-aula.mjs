// Canario del canal de aula (VEN/SEG/MEM/B2B/BEC).
//
// El canal NO es un dato: se deduce por descarte y BECA es el ELSE de la
// cascada, asi que cualquier hueco de datos aterriza ahi en silencio (caso
// 03/08/26: socio WE BLACK saliendo BEC). Este script hace ruidoso lo que el
// ERP hoy se traga. Correrlo cuando se toque el registro FICO o el aula:
//
//   node scripts/canario-canal-aula.mjs
//
// Si "sin explicacion" baja a ~0, el ELSE 'BECA' de edition.repository.js puede
// voltearse a 'REVISAR' y el bug deja de ser posible.
import { q, pool } from './db.mjs'

const show = (t, rows) => { console.log(`\n=== ${t} (${rows.length}) ===`); if (rows.length) console.table(rows) }

try {
  // 1. Ventas en 0 que el aula marcaria BECA sin ninguna evidencia de beca.
  //    Beca explicita = descuento 17 'GLOBAL/BECA 100%'.
  const { rows: sinExplicacion } = await q(`
    WITH hojas AS (
      SELECT e.enrollment_id, cust.person_id,
             TRIM(concat_ws(' ', per.first_name, per.last_name)) AS alumno,
             e.program_edition_id,
             COALESCE(par.total_amount, e.total_amount, 0) AS venta,
             COALESCE(par.membership_program_id, e.membership_program_id) AS tier,
             COALESCE(e.cat_b2b_doctype, par.cat_b2b_doctype) AS b2b,
             COALESCE(CASE WHEN e.parent_enrollment_id IS NOT NULL THEN par.notes ELSE e.notes END, '') AS notas,
             EXISTS (SELECT 1 FROM public.enrollment_discounts ed
                      WHERE ed.enrollment_id = COALESCE(e.parent_enrollment_id, e.enrollment_id)
                        AND ed.discount_id = 17) AS beca_explicita,
             EXISTS (SELECT 1 FROM public.course_changes cc
                      WHERE cc.enrollment_destination_id = COALESCE(e.parent_enrollment_id, e.enrollment_id)) AS es_cc
        FROM public.enrollments e
        JOIN public.customers cust ON cust.customer_id = e.customer_id
        JOIN public.persons per ON per.person_id = cust.person_id
        JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
   LEFT JOIN public.enrollments par ON par.enrollment_id = e.parent_enrollment_id
       WHERE e.active = 'Y'
         AND NOT EXISTS (SELECT 1 FROM public.enrollments ch WHERE ch.parent_enrollment_id = e.enrollment_id)
    )
    SELECT enrollment_id, alumno, program_edition_id
      FROM hojas
     WHERE venta = 0 AND tier IS NULL AND b2b IS NULL AND NOT beca_explicita AND NOT es_cc
       AND notas NOT ILIKE '%desde inscripcion #%'
     ORDER BY enrollment_id DESC LIMIT 15
  `)
  show('Marcadas BECA sin evidencia de beca (muestra de 15; corre el COUNT abajo)', sinExplicacion)

  // 2. Personas gemelas: el SP crea persona nueva cuando la venta va sin
  //    documento. Si la membresia cae en la gemela, el socio "desaparece".
  const { rows: gemelas } = await q(`
    SELECT lower(pc.value) AS email,
           string_agg(DISTINCT per.person_id::text, ',') AS person_ids,
           string_agg(DISTINCT COALESCE(per.document_number, 'SIN-DNI'), ',') AS docs
      FROM public.person_contacts pc
      JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_email'
      JOIN public.persons per ON per.person_id = pc.person_id AND per.active = 'Y'
     WHERE pc.active = 'Y'
     GROUP BY 1
    HAVING COUNT(DISTINCT per.person_id) > 1
       AND bool_or(per.document_number IS NULL)
       -- solo las que importan: alguna de las gemelas tiene membresia
       AND EXISTS (
         SELECT 1 FROM public.enrollments em
           JOIN public.customers cm ON cm.customer_id = em.customer_id
           JOIN public.program_versions pvm ON pvm.program_version_id = em.program_version_id
           JOIN public.programs pm ON pm.program_id = pvm.program_id AND pm.is_membership = true
          WHERE cm.person_id = ANY(array_agg(per.person_id)) AND em.active = 'Y')
     ORDER BY 1
  `)
  show('Personas gemelas (mismo correo, una sin DNI) CON membresia de por medio', gemelas)

  // 3. Resumen: la metrica que hay que ver bajar.
  const { rows: [r] } = await q(`
    SELECT (SELECT COUNT(*)::int FROM public.persons WHERE document_number IS NULL AND active='Y') AS personas_sin_doc,
           (SELECT COUNT(*)::int FROM public.enrollments e
              JOIN public.customers cu ON cu.customer_id = e.customer_id
              JOIN public.persons p ON p.person_id = cu.person_id
              JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
              JOIN public.programs pr ON pr.program_id = pv.program_id AND pr.is_membership
             WHERE p.document_number IS NULL AND e.active='Y') AS membresias_en_persona_sin_doc
  `)
  console.log('\n=== resumen ===')
  console.table([r])
} finally {
  await pool.end()
}
