// One-off: por qué el cronograma cuenta 25 en AULA de SAP HANA MM (ED 15626)
// y no 26 (19+1 propios + 5+1 del padre ESPEC. SAP LOG. INTEGRAL 15625).
// Replica el roster de classroomChannelMetricsList y lo lista inscrito por inscrito.
import { q, pool } from './db.mjs'

const IDS = [15625, 15816, 15626]

const roster = `
  WITH roster AS (
    SELECT
      e.enrollment_id,
      e.program_edition_id AS edition_num_id,
      cust.person_id,
      TRIM(COALESCE(pe_c.first_name,'') || ' ' || COALESCE(pe_c.last_name,'')) AS alumno,
      e.parent_enrollment_id,
      e.total_amount,
      cts.alias AS type_status,
      parcts.alias AS parent_type_status,
      CASE
        WHEN EXISTS (SELECT 1 FROM public.course_changes cc
                      WHERE cc.enrollment_destination_id = e.enrollment_id)
          OR e.notes ILIKE '%Reprogramacion desde inscripcion #%'
          THEN CASE WHEN mem.is_member THEN 'MEMB' ELSE 'SEGUI' END
        WHEN e.parent_enrollment_id IS NOT NULL THEN
          CASE
            WHEN par.program_edition_id IS NOT NULL AND NOT EXISTS (
                   SELECT 1 FROM public.enrollments sib
                     JOIN public.program_editions pesib
                       ON pesib.edition_num_id = sib.program_edition_id
                    WHERE sib.parent_enrollment_id = e.parent_enrollment_id
                      AND sib.enrollment_id <> e.enrollment_id
                      AND (pesib.start_date, pesib.edition_num_id)
                        < (pe_e.start_date, pe_e.edition_num_id)
                 ) THEN NULL
            WHEN mem.is_member THEN 'MEMB'
            WHEN par.cat_b2b_doctype IS NOT NULL
              OR (par.agent_origin ILIKE '%b2b%'
                  AND (upar.alias IS NULL OR upar.alias IN ('NY12','JF39'))) THEN 'B2B'
            WHEN COALESCE(par.total_amount, 0) = 0 AND NOT mem.has_membership
              AND COALESCE(par.notes, '') NOT ILIKE '%desde inscripcion #%'
              AND NOT EXISTS (SELECT 1 FROM public.course_changes ccp
                               WHERE ccp.enrollment_destination_id = par.enrollment_id) THEN 'BECA'
            ELSE 'SEGUI'
          END
        WHEN mem.is_member THEN 'MEMB'
        WHEN e.cat_b2b_doctype IS NOT NULL
          OR (e.agent_origin ILIKE '%b2b%'
              AND (ua.alias IS NULL OR ua.alias IN ('NY12','JF39'))) THEN 'B2B'
        WHEN COALESCE(e.total_amount, 0) = 0 AND NOT mem.has_membership THEN 'BECA'
        ELSE 'VENTAS'
      END AS comm_bucket,
      (NOT EXISTS (SELECT 1 FROM public.enrollments ch
                    WHERE ch.parent_enrollment_id = e.enrollment_id)) AS is_leaf,
      (COALESCE(e.cat_b2b_doctype, par.cat_b2b_doctype) IS NULL
        AND NOT (COALESCE(par.agent_origin, e.agent_origin, '') ILIKE '%b2b%'
                 AND (COALESCE(upar.alias, ua.alias) IS NULL
                      OR COALESCE(upar.alias, ua.alias) IN ('NY12','JF39')))
        AND COALESCE(par.total_amount, e.total_amount, 0) = 0
        AND NOT mem.has_membership
        AND COALESCE(CASE WHEN e.parent_enrollment_id IS NOT NULL
                          THEN par.notes ELSE e.notes END, '')
            NOT ILIKE '%desde inscripcion #%'
        AND NOT EXISTS (SELECT 1 FROM public.course_changes ccx
                         WHERE ccx.enrollment_destination_id
                               = COALESCE(e.parent_enrollment_id, e.enrollment_id))) AS is_beca_leaf
      FROM public.enrollments e
      JOIN public."catalog" cf   ON cf.catalog_id = e.cat_fico_status
      LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
      JOIN public.customers cust ON cust.customer_id = e.customer_id
      JOIN public.persons pe_c ON pe_c.person_id = cust.person_id
      JOIN public.program_editions pe_e ON pe_e.edition_num_id = e.program_edition_id
      LEFT JOIN public.enrollments par ON par.enrollment_id = e.parent_enrollment_id
      LEFT JOIN public."catalog" parcts ON parcts.catalog_id = par.cat_type_status
      LEFT JOIN public.users ua   ON ua.user_id = e.seller_agent_id
      LEFT JOIN public.users upar ON upar.user_id = par.seller_agent_id
      LEFT JOIN LATERAL (
        SELECT
          EXISTS (
            SELECT 1 FROM public.enrollments em
              JOIN public.customers cm         ON cm.customer_id = em.customer_id
              JOIN public.program_versions pvm ON pvm.program_version_id = em.program_version_id
              JOIN public.programs pm          ON pm.program_id = pvm.program_id AND pm.is_membership = true
                                                AND UPPER(TRIM(pm.program_name)) <> 'MEMBRESIA PLUS'
              JOIN public."catalog" cfm        ON cfm.catalog_id = em.cat_fico_status AND cfm.alias = 'we_enrollment_status_checked'
             WHERE cm.person_id = cust.person_id AND em.active = 'Y'
          ) AS is_member,
          EXISTS (
            SELECT 1 FROM public.enrollments em
              JOIN public.customers cm         ON cm.customer_id = em.customer_id
              JOIN public.program_versions pvm ON pvm.program_version_id = em.program_version_id
              JOIN public.programs pm          ON pm.program_id = pvm.program_id AND pm.is_membership = true
              JOIN public."catalog" cfm        ON cfm.catalog_id = em.cat_fico_status AND cfm.alias = 'we_enrollment_status_checked'
             WHERE cm.person_id = cust.person_id AND em.active = 'Y'
          ) AS has_membership
      ) mem ON TRUE
     WHERE e.program_edition_id = ANY($1::int[])
       AND e.active = 'Y'
       AND cf.alias = 'we_enrollment_status_checked'
       AND (cts.alias IS NULL OR cts.alias NOT IN (
              'we_enrollment_status_retired',
              'we_enrollment_status_course_changed',
              'we_enrollment_status_reprogrammed'
            ))
       AND (parcts.alias IS NULL OR parcts.alias <> 'we_enrollment_status_reprogrammed')
  )
`

const agg = await q(`${roster}
  SELECT edition_num_id,
    COUNT(*) FILTER (WHERE comm_bucket='VENTAS')::int AS ventas,
    COUNT(*) FILTER (WHERE comm_bucket='SEGUI')::int  AS segui,
    COUNT(*) FILTER (WHERE comm_bucket='MEMB')::int   AS memb,
    COUNT(*) FILTER (WHERE comm_bucket='BECA')::int   AS beca,
    COUNT(*) FILTER (WHERE comm_bucket='B2B')::int    AS b2b,
    COUNT(*) FILTER (WHERE is_leaf AND NOT is_beca_leaf)::int AS cnt_aula,
    COUNT(*) FILTER (WHERE is_leaf)::int              AS cnt_total
  FROM roster GROUP BY edition_num_id ORDER BY edition_num_id`, [IDS])
console.log('== Contadores del cronograma (mismo SQL) ==')
console.table(agg.rows)

const det = await q(`${roster}
  SELECT enrollment_id, edition_num_id, alumno, parent_enrollment_id, total_amount,
         type_status, parent_type_status, comm_bucket, is_leaf, is_beca_leaf
    FROM roster ORDER BY edition_num_id, is_leaf DESC, alumno`, [IDS])
console.log('\n== Detalle por inscrito ==')
console.table(det.rows)

// Todo lo que la BD tiene en esas ediciones, incluso lo filtrado, para ver quién cae.
const crudo = await q(`
  SELECT e.enrollment_id, e.program_edition_id AS ed, e.active,
         TRIM(COALESCE(p.first_name,'')||' '||COALESCE(p.last_name,'')) AS alumno,
         cf.alias AS fico, cts.alias AS type_status, e.parent_enrollment_id,
         par.program_edition_id AS ed_padre, parcts.alias AS type_status_padre,
         e.total_amount,
         EXISTS (SELECT 1 FROM public.enrollments ch WHERE ch.parent_enrollment_id = e.enrollment_id) AS tiene_hijos
    FROM public.enrollments e
    JOIN public.customers cu ON cu.customer_id = e.customer_id
    JOIN public.persons p ON p.person_id = cu.person_id
    LEFT JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
    LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
    LEFT JOIN public.enrollments par ON par.enrollment_id = e.parent_enrollment_id
    LEFT JOIN public."catalog" parcts ON parcts.catalog_id = par.cat_type_status
   WHERE e.program_edition_id = ANY($1::int[])
   ORDER BY e.program_edition_id, e.enrollment_id`, [IDS])
console.log('\n== CRUDO: todas las inscripciones de las 3 ediciones ==')
console.table(crudo.rows)

await pool.end()
