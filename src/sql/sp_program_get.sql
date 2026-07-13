CREATE OR REPLACE PROCEDURE public.sp_program_get(IN p_program_id integer, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
BEGIN
  IF p_cur IS NULL THEN
    p_cur := 'cur_sp_program_get';
  END IF;

  OPEN p_cur FOR
    SELECT
      p.program_id,
      p.program_name,
      p.cat_type_program,
      ct.description AS cat_type_program_label,
      p.cat_category,
      cc.description AS cat_category_label,
      p.cat_business_line_id,
      p.cat_model_modality,
      cm.description AS cat_model_modality_label,
      p.active,
      p.user_registration_id,
	  p.skem_clasification,
      p.user_modification_id,
      p.registration_date,
      p.modification_date,
	  p.link,
      -- JSONB con las versiones + estructura hijos
      (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'program_version_id',   pv.program_version_id,
                   'program_id',           pv.program_id,
                   'version_code',         pv.version_code,
                   'expedient_link',         pv.expedient_link,
                   'sessions',             pv.sessions,
                   'active',               pv.active,
                   'observations',         pv.observations,
                   'description',          pv.description, 
                   'brand_name',          pv.brand_name, 
                   'abbreviation',         pv.abbreviation,
                   'user_registration_id', pv.user_registration_id,
                   'cat_course_category',         coa.catalog_id,
                   'cat_course_category_label', coa.description,
                   'user_modification_id', pv.user_modification_id,
                   'registration_date',    pv.registration_date,
                   'modification_date',    pv.modification_date,
                   'children_ids',
                     COALESCE(
                       (
                         SELECT jsonb_agg(pvs.child_program_version_id
                                          ORDER BY pvs.sort_order)  -- 👈 orden por sort_order
                         FROM public.program_version_structure pvs
                         WHERE pvs.parent_program_version_id = pv.program_version_id
                       ),
                       '[]'::jsonb
                     ),
                   'children_detail',
                     COALESCE(
                       (
                         SELECT jsonb_agg(
                                  jsonb_build_object(
                                    'child_program_version_id', pv_child.program_version_id,
                                    'program_name',             p_child.program_name,
                                    'version_code',             pv_child.version_code,
                                    'abbreviation',             pv_child.abbreviation,
                                    'sort_order',               pvs2.sort_order    -- 👈 enviado al front
                                  )
                                  ORDER BY pvs2.sort_order        -- 👈 orden consistente
                                )
                         FROM public.program_version_structure pvs2
                         JOIN public.program_versions pv_child
                           ON pv_child.program_version_id = pvs2.child_program_version_id
                         JOIN public.programs p_child
                           ON p_child.program_id = pv_child.program_id
                         WHERE pvs2.parent_program_version_id = pv.program_version_id
                       ),
                       '[]'::jsonb
                     )
                 )
                 ORDER BY pv.program_version_id
               )
        FROM public.program_versions pv
		LEFT JOIN catalog coa on coa.catalog_id = pv.cat_course_category
        WHERE pv.program_id = p.program_id
      ) AS program_versions
    FROM public.programs p
    LEFT JOIN public."catalog" ct ON ct.catalog_id = p.cat_type_program
    LEFT JOIN public."catalog" cc ON cc.catalog_id = p.cat_category
    LEFT JOIN public."catalog" cm ON cm.catalog_id = p.cat_model_modality
    WHERE p.program_id = p_program_id;
END;
$procedure$

