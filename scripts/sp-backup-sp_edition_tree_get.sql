CREATE OR REPLACE PROCEDURE public.sp_edition_tree_get(IN p_edition_num_id integer, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
BEGIN
  IF p_cur IS NULL THEN
    p_cur := 'cur_sp_edition_tree_get';
  END IF;

  OPEN p_cur FOR
  WITH
  --------------------------------------------------------------------
  -- 1) EDICIÓN PADRE + METADATOS DE PROGRAMA / VERSIÓN
  --------------------------------------------------------------------
  parent AS (
    SELECT
      pe.edition_num_id,
      pe.program_version_id,
      pe.instructor_id,
      pe.start_date,
      pe.end_date,
      pe.cat_type_approved,
      pe.cat_status_edition,
      pe.vacant,
      pe.specific_code,
      pe.global_code,
      pe.whatsapp_link,
      pe.teams_link,
      -- TRANSFORMACIÓN DE BPCHAR A BOOLEAN (Padre)
      CASE WHEN pe.expedient = 'Y' THEN true ELSE false END AS expedient,
      CASE WHEN pe.upgrade = 'Y' THEN true ELSE false END AS upgrade,
      CASE WHEN pe.confirmation = 'Y' THEN true ELSE false END AS confirmation,
      CASE WHEN pe.preconfirmation = 'Y' THEN true ELSE false END AS preconfirmation,
      CASE WHEN pe.active = 'Y' THEN true ELSE false END AS active,
      
      pe.notes,
      pe.clasification,

      -- combinaciones del padre
      pe.cat_day_combination_id,
      pe.cat_hour_combination_id,
	 cgg.description as cat_segment_label,
	 cgg.catalog_id as cat_segment_id,
      dayc.description  AS day_combination_label,
      hourc.description AS hour_combination_label,

      INITCAP(
  CONCAT(
    COALESCE(per.first_name, ''),
    CASE WHEN per.first_name IS NOT NULL THEN ' ' ELSE '' END,
    COALESCE(per.last_name, ''),
    CASE
      WHEN per.last_name IS NOT NULL
        AND per.mother_last_name IS NOT NULL
      THEN ' '
      ELSE ''
    END,
    COALESCE(per.mother_last_name, '')
  )
) AS instructor_label,

      -- programa / versión
      pv.abbreviation           AS abbreviation,
      pv.version_code           AS version_code,
      pv.description           AS program_public_label,
      pv.sessions               AS sessions,
      p.skem_clasification     AS skem_clasification,

      p.program_id,
      p.program_name,
      p.cat_type_program,
      ctp.alias                 AS cat_type_program_alias,
      ctp.description           AS cat_type_program_label,
      p.cat_model_modality,
      cmm.description           AS cat_model_modality_label,
      p.cat_category,
      ccat.description          AS cat_category_label,

      pe.user_registration_id,
      pe.user_modification_id,
      pe.registration_date,
      pe.modification_date,

      -- schedules del padre (si tiene combinación)
      CASE
        WHEN pe.cat_day_combination_id IS NULL
         AND pe.cat_hour_combination_id IS NULL
        THEN '[]'::jsonb
        ELSE jsonb_build_array(
          jsonb_build_object(
            'cat_day_combination_id',   pe.cat_day_combination_id,
            'day_combination_label',    dayc.description,
            'cat_hour_combination_id',  pe.cat_hour_combination_id,
            'hour_combination_label',   hourc.description
          )
        )
      END AS schedules
    FROM public.program_editions pe
    LEFT JOIN public.instructors i
      ON i.instructor_id = pe.instructor_id
        LEFT JOIN public.persons per
          ON per.person_id = i.person_id
    JOIN public.program_versions pv
      ON pv.program_version_id = pe.program_version_id
    JOIN public.programs p
      ON p.program_id = pv.program_id
    LEFT JOIN public.catalog cgg
      ON cgg.catalog_id = pe.cat_segment
    JOIN public.catalog ctp
      ON ctp.catalog_id = p.cat_type_program
    LEFT JOIN public.catalog cmm
      ON cmm.catalog_id = p.cat_model_modality
    LEFT JOIN public.catalog ccat
      ON ccat.catalog_id = p.cat_category
    LEFT JOIN public.catalog dayc
      ON dayc.catalog_id = pe.cat_day_combination_id
    LEFT JOIN public.catalog hourc
      ON hourc.catalog_id = pe.cat_hour_combination_id
    WHERE pe.edition_num_id = p_edition_num_id
  ),
  --------------------------------------------------------------------
  -- 2) HIJOS (editions hijas) PARA LA JERARQUÍA
  --------------------------------------------------------------------
  children AS (
    SELECT
      p_edition_num_id AS parent_edition_id,
      jsonb_agg(
        jsonb_build_object(
          -- Datos que vienen de la Estructura (Siempre existirán)
          'child_program_version_id',  pvs.child_program_version_id,
          'abbreviation',              pv_child.abbreviation,
          'program_public_label',              pv_child.description,
          'sessions',                  pv_child.sessions,
          'sort_order',                pvs.sort_order,
          
          -- Datos de la Edición (Pueden ser NULL si no hay edición creada)
          'edition_id',                ch.edition_num_id,
          'specific_code',             ch.specific_code,
          'global_code',               ch.global_code,
          'clasification',             ch.clasification,
          'start_date',                ch.start_date,
          'end_date',                  ch.end_date,

          -- Combinaciones (NULL si no hay edición)
          'cat_day_combination_id',    ch.cat_day_combination_id,
          'cat_hour_combination_id',   ch.cat_hour_combination_id,
          'day_combination_label',     dayc2.description,
          'hour_combination_label',    hourc2.description,

          -- Docente (NULL si no hay edición)
          'instructor_id',             ch.instructor_id,
          'instructor_label',
			CASE 
			  WHEN ch.edition_num_id IS NOT NULL THEN
			    INITCAP(
			      CONCAT(
			        COALESCE(perch.first_name, ''),
			        CASE WHEN perch.first_name IS NOT NULL THEN ' ' ELSE '' END,
			        COALESCE(perch.last_name, '')
			      )
			    )
			  ELSE NULL 
			END,

          -- Modalidad (Viene del programa hijo, suele estar definido siempre)
          'cat_model_modality_label',  cmm_child.description,

          -- Estados transformados (Si no hay edición, por defecto false)
          'expedient',                 COALESCE(ch.expedient = 'Y', true),
          'upgrade',                   COALESCE(ch.upgrade = 'Y', false),
          'active',                    COALESCE(ch.active = 'Y', true),
          'preconfirmation',           COALESCE(ch.preconfirmation = 'Y', false),
          'confirmation',              COALESCE(ch.confirmation = 'Y', false),

          -- Lógica Front-end: 
          -- Si no hay edition_num_id, es una fila nueva para el front
          'new',                       (CASE WHEN ch.edition_num_id IS NULL THEN true ELSE false END)
        )
        -- Ordenamos por el orden de la estructura
        ORDER BY pvs.sort_order, ch.start_date, pv_child.abbreviation
      ) AS children
    FROM public.program_versions pv_parent
    -- 1. Partimos de la estructura del programa padre
    JOIN public.program_version_structure pvs
      ON pvs.parent_program_version_id = pv_parent.program_version_id
    -- 2. Traemos la info de los programas hijos
    JOIN public.program_versions pv_child
      ON pv_child.program_version_id = pvs.child_program_version_id
    JOIN public.programs p_child
      ON p_child.program_id = pv_child.program_id
    -- 3. Buscamos si existe una relación ya creada en la jerarquía de ediciones
    LEFT JOIN public.edition_structure es
      ON es.parent_edition_id = p_edition_num_id 
      AND es.child_edition_id IN (
          SELECT edition_num_id FROM public.program_editions 
          WHERE program_version_id = pvs.child_program_version_id
      )
    -- 4. Traemos la data de la edición hija (si existe)
    LEFT JOIN public.program_editions ch
      ON ch.edition_num_id = es.child_edition_id
    -- Los demás Joins se vuelven LEFT para no filtrar si falta data
    LEFT JOIN public.catalog cmm_child
      ON cmm_child.catalog_id = p_child.cat_model_modality
    LEFT JOIN public.instructors ich
      ON ich.instructor_id = ch.instructor_id
    LEFT JOIN public.persons perch
      ON perch.person_id = ich.person_id
    LEFT JOIN public.catalog dayc2
      ON dayc2.catalog_id = ch.cat_day_combination_id
    LEFT JOIN public.catalog hourc2
      ON hourc2.catalog_id = ch.cat_hour_combination_id
    WHERE pv_parent.program_version_id = (
        SELECT program_version_id FROM public.program_editions WHERE edition_num_id = p_edition_num_id
    )
    GROUP BY pv_parent.program_version_id
  )

  --------------------------------------------------------------------
  -- 3) RESULTADO: 1 row (padre) + jsonb children
  --------------------------------------------------------------------
  SELECT
    p.*,
    COALESCE(c.children, '[]'::jsonb) AS children
  FROM parent   p
  LEFT JOIN children c
    ON c.parent_edition_id = p.edition_num_id;
END;
$procedure$
