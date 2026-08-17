// One-off: por que el cronograma muestra AULA 14 en POWER APPS Y AUT. (12 Sep)
// si VENTAS/SEGUI/MEMB/B2B/BECA suman 12. Replica el roster de
// edition.repository.js#classroomChannelMetricsList fila por fila.
import { q, pool } from './db.mjs'

const ed = await q(`
  SELECT pe.edition_num_id, pe.global_code, pe.start_date, p.program_name
    FROM public.program_editions pe
    JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN public.programs p ON p.program_id = pv.program_id
   WHERE p.program_name ILIKE '%POWER APPS%'
   ORDER BY pe.start_date DESC`)
console.table(ed.rows)

const id = Number(process.argv[2] || ed.rows[0]?.edition_num_id)
console.log('\n== edicion', id, '==\n')

const { rows } = await q(`
  WITH roster AS (
    SELECT
      e.enrollment_id, e.parent_enrollment_id, e.total_amount,
      cust.person_id, cts.alias AS tipo_estado, e.notes,
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
                               = COALESCE(e.parent_enrollment_id, e.enrollment_id))) AS is_beca_leaf,
      par.program_edition_id AS padre_edicion,
      pp.program_name AS padre_programa
      FROM public.enrollments e
      JOIN public."catalog" cf   ON cf.catalog_id = e.cat_fico_status
      LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
      JOIN public.customers cust ON cust.customer_id = e.customer_id
      JOIN public.program_editions pe_e ON pe_e.edition_num_id = e.program_edition_id
      LEFT JOIN public.enrollments par ON par.enrollment_id = e.parent_enrollment_id
      LEFT JOIN public.program_versions ppv ON ppv.program_version_id = par.program_version_id
      LEFT JOIN public.programs pp ON pp.program_id = ppv.program_id
      LEFT JOIN public."catalog" parcts ON parcts.catalog_id = par.cat_type_status
      LEFT JOIN public.users ua   ON ua.user_id = e.seller_agent_id
      LEFT JOIN public.users upar ON upar.user_id = par.seller_agent_id
      LEFT JOIN LATERAL (
        SELECT
          (EXISTS (SELECT 1 FROM public.enrollments em
             JOIN public.customers cm ON cm.customer_id = em.customer_id
             JOIN public.program_versions pvm ON pvm.program_version_id = em.program_version_id
             JOIN public.programs pm ON pm.program_id = pvm.program_id AND pm.is_membership = true
                                    AND UPPER(TRIM(pm.program_name)) <> 'MEMBRESIA PLUS'
             JOIN public."catalog" cfm ON cfm.catalog_id = em.cat_fico_status AND cfm.alias = 'we_enrollment_status_checked'
            WHERE cm.person_id = cust.person_id AND em.active = 'Y')
           OR EXISTS (SELECT 1 FROM public.programs pmv
                       WHERE pmv.program_id = COALESCE(par.membership_program_id, e.membership_program_id)
                         AND pmv.is_membership = true
                         AND UPPER(TRIM(pmv.program_name)) <> 'MEMBRESIA PLUS')) AS is_member,
          (EXISTS (SELECT 1 FROM public.enrollments em
             JOIN public.customers cm ON cm.customer_id = em.customer_id
             JOIN public.program_versions pvm ON pvm.program_version_id = em.program_version_id
             JOIN public.programs pm ON pm.program_id = pvm.program_id AND pm.is_membership = true
             JOIN public."catalog" cfm ON cfm.catalog_id = em.cat_fico_status AND cfm.alias = 'we_enrollment_status_checked'
            WHERE cm.person_id = cust.person_id AND em.active = 'Y')
           OR COALESCE(par.membership_program_id, e.membership_program_id) IS NOT NULL) AS has_membership
      ) mem ON TRUE
     WHERE e.program_edition_id = $1
       AND e.active = 'Y'
       AND cf.alias = 'we_enrollment_status_checked'
       AND (cts.alias IS NULL OR cts.alias NOT IN (
              'we_enrollment_status_retired',
              'we_enrollment_status_course_changed',
              'we_enrollment_status_reprogrammed'))
       AND (parcts.alias IS NULL OR parcts.alias <> 'we_enrollment_status_reprogrammed')
  )
  SELECT enrollment_id, parent_enrollment_id, padre_edicion, padre_programa,
         total_amount, comm_bucket, is_leaf, is_beca_leaf, tipo_estado
    FROM roster ORDER BY comm_bucket NULLS FIRST, enrollment_id`, [id])

console.table(rows)
const c = (f) => rows.filter(f).length
console.log({
  VENTAS: c(r => r.comm_bucket === 'VENTAS'),
  SEGUI: c(r => r.comm_bucket === 'SEGUI'),
  MEMB: c(r => r.comm_bucket === 'MEMB'),
  B2B: c(r => r.comm_bucket === 'B2B'),
  BECA: c(r => r.comm_bucket === 'BECA'),
  SIN_BUCKET_1er_curso: c(r => r.comm_bucket === null),
  AULA: c(r => r.is_leaf && !r.is_beca_leaf),
  TOTAL_HOJAS: c(r => r.is_leaf)
})
await pool.end()
