CREATE OR REPLACE PROCEDURE public.sp_edition_by_week_list(IN p_filters jsonb, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
  v_year  int;
  v_month int;
BEGIN
  IF p_cur IS NULL THEN
    p_cur := 'cur_sp_edition_list';
  END IF;

  v_year  := COALESCE((p_filters->>'selectedYear')::int, EXTRACT(YEAR FROM current_date)::int);
  v_month := COALESCE((p_filters->>'selectedMonth')::int, EXTRACT(MONTH FROM current_date)::int);

  OPEN p_cur FOR

WITH RECURSIVE
  -- 1) Agregados de HIJOS por edición PADRE
  child_agg AS (
    SELECT
      estr.parent_edition_id,
      MIN(ch.start_date) AS min_start_date,
      MAX(ch.end_date)   AS max_end_date,
      STRING_AGG(
  DISTINCT INITCAP(CONCAT_WS(' ', per.first_name, per.last_name)),
  ', '
) AS instructors
    FROM public.edition_structure estr
    JOIN public.program_editions ch ON ch.edition_num_id = estr.child_edition_id
    LEFT JOIN public.instructors i ON i.instructor_id = ch.instructor_id
    LEFT JOIN public.persons per ON per.person_id = i.person_id
    GROUP BY estr.parent_edition_id
  ),
-- 2) Combinaciones de días/horas de HIJOS
child_combos AS (
  SELECT
    parent_edition_id,
    jsonb_agg(schedule ORDER BY sort_order) AS schedules
  FROM (
    SELECT DISTINCT
      estr.parent_edition_id,
      estr.sort_order,
      jsonb_build_object(
        'cat_day_combination_id',   ch.cat_day_combination_id,
        'day_combination_label',    dayc.description,
        'cat_hour_combination_id',  ch.cat_hour_combination_id,
        'hour_combination_label',   hourc.description,
        'active', (CASE WHEN ch.active = 'Y' THEN true ELSE false END),
        'specific_code', ch.specific_code
      ) AS schedule
    FROM public.edition_structure estr
    JOIN public.program_editions ch 
      ON ch.edition_num_id = estr.child_edition_id
    LEFT JOIN public.catalog dayc 
      ON dayc.catalog_id = ch.cat_day_combination_id
    LEFT JOIN public.catalog hourc 
      ON hourc.catalog_id = ch.cat_hour_combination_id
  ) t
  GROUP BY parent_edition_id
),
 -- 2.1) Flags agregados de HIJOS
    child_flags AS (
      SELECT
        estr.parent_edition_id,
        CASE 
          WHEN BOOL_AND(ch.expedient = 'Y') THEN 'Y' 
          ELSE 'N' 
        END AS expedient_agg,
        CASE 
          WHEN BOOL_AND(ch.upgrade = 'Y') THEN 'Y' 
          ELSE 'N' 
        END AS upgrade_agg,
        CASE 
          WHEN BOOL_AND(ch.preconfirmation = 'Y') THEN 'Y' 
          ELSE 'N' 
        END AS preconfirmation_agg,
        CASE 
          WHEN BOOL_AND(ch.confirmation = 'Y') THEN 'Y' 
          ELSE 'N' 
        END AS confirmation_agg
      FROM public.edition_structure estr
      JOIN public.program_editions ch ON ch.edition_num_id = estr.child_edition_id
      GROUP BY estr.parent_edition_id
    ),

  -- 2.5) Conteo de ediciones
  edition_count AS (
    SELECT pv.program_id, COUNT(*) AS total_editions
    FROM public.program_editions pe
    JOIN public.program_versions pv ON pe.program_version_id = pv.program_version_id
    GROUP BY pv.program_id
  ),
	
  -- 3) Ediciones "raw"
  editions_raw AS (
    SELECT
      pe.edition_num_id,
      p.program_id,
      pe.global_code,
      pe.specific_code,
      pe.whatsapp_link,
      pe.teams_link,
      pv.abbreviation              AS program_abreviature,
	  pv.description           AS program_public_label,
      cot.description              AS program_line_business,
      cot.alias                    AS program_line_business_alias,
      ccat.alias                   AS cat_course_category_alias,
      ccat.description             AS cat_course_category_label,
      cat.description              AS program_type,
      cat.alias                    AS program_type_alias,
      pv.sessions                  AS program_sessions,
      pv.version_code              AS version_code,
        COALESCE(cf.expedient_agg, pe.expedient) AS expedient,
        COALESCE(cf.upgrade_agg, pe.upgrade) AS upgrade,
      pe.clasification,
      INITCAP(CONCAT_WS(' ', per.first_name, per.last_name)) AS instructor_base,
      pe.program_version_id,
        COALESCE(cf.preconfirmation_agg, pe.preconfirmation) AS preconfirmation,
        COALESCE(cf.confirmation_agg, pe.confirmation) AS confirmation,
      pe.new_methodology,
      pe.instructor_id,
      pe.start_date,
      pe.end_date,
      pe.cat_type_approved,
      pe.cat_status_edition,
      pe.vacant,
      pe.active,
      pe.user_registration_id,
      pe.user_modification_id,
      pe.registration_date,
      pe.modification_date,
      pe.notes,
      ca.min_start_date,
      ca.max_end_date,
      ca.instructors AS child_instructors,
      cc.schedules AS child_schedules,
      CASE
        WHEN pe.cat_day_combination_id IS NULL AND pe.cat_hour_combination_id IS NULL THEN NULL
        ELSE jsonb_build_array(jsonb_build_object(
            'cat_day_combination_id',   pe.cat_day_combination_id,
            'day_combination_label',    dayc.description,
            'cat_hour_combination_id',  pe.cat_hour_combination_id,
            'hour_combination_label',   hourc.description
          ))
      END AS own_schedules,
      COALESCE(cota.description,
      CASE 
        WHEN pe.active = 'N' THEN 'A5'
        WHEN COALESCE(ec.total_editions, 0) <= 2 THEN 'A6'
        ELSE 
          CASE 
            WHEN (cat.alias = 'we_program_type_course' and NOT EXISTS (SELECT 1 FROM public.edition_structure es WHERE es.child_edition_id = pe.edition_num_id)) 
                 OR cat.alias <> 'we_program_type_course' THEN 'A1'
            ELSE 'A2'
          END
      END) AS cat_segment
    FROM public.program_editions pe
    JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
    LEFT JOIN public.catalog ccat on ccat.catalog_id = pv.cat_course_category
    JOIN public.programs p ON p.program_id = pv.program_id
    JOIN public.catalog cat ON cat.catalog_id = p.cat_type_program
    LEFT JOIN public.catalog cota ON cota.catalog_id = pe.cat_segment
    JOIN public.catalog cot ON cot.catalog_id = p.cat_category
    LEFT JOIN public.instructors i ON i.instructor_id = pe.instructor_id
    LEFT JOIN public.persons per ON per.person_id = i.person_id
    LEFT JOIN child_agg     ca ON ca.parent_edition_id = pe.edition_num_id
    LEFT JOIN child_combos   cc ON cc.parent_edition_id = pe.edition_num_id
    LEFT JOIN child_flags   cf ON cf.parent_edition_id = pe.edition_num_id
    LEFT JOIN public.catalog dayc ON dayc.catalog_id = pe.cat_day_combination_id
    LEFT JOIN public.catalog hourc ON hourc.catalog_id = pe.cat_hour_combination_id
    LEFT JOIN edition_count ec ON ec.program_id = p.program_id
  ),

  -- 4) Ediciones con campos "efectivos" y ORDENAMIENTO
  editions AS (
    SELECT
      er.edition_num_id,
      er.program_id,
	er.program_public_label,
      er.global_code,
      er.whatsapp_link,
      er.teams_link,
      er.specific_code,
      er.program_abreviature,
      er.program_line_business,
      er.program_line_business_alias,
      er.cat_course_category_alias,
      er.cat_course_category_label,
      er.version_code,
      er.program_type,
      er.program_type_alias,
      er.program_sessions,
      er.expedient,
      er.clasification,
      er.cat_segment,
      CASE
        WHEN er.program_type_alias = 'we_program_type_course' THEN er.instructor_base
        ELSE COALESCE(er.child_instructors, er.instructor_base)
      END AS instructor,
      er.preconfirmation,
      er.confirmation,
      er.upgrade,
      er.new_methodology,
      er.program_version_id,
      er.instructor_id,
      -- FECHAS EFECTIVAS
      CASE
        WHEN er.program_type_alias = 'we_program_type_course' THEN er.start_date
        ELSE (
            CASE
                WHEN er.start_date is not null and er.user_modification_id is null THEN er.start_date
                ELSE COALESCE(er.min_start_date, er.start_date)
            END
        )
      END AS start_date_eff,
      CASE
        WHEN er.program_type_alias = 'we_program_type_course' THEN er.end_date
        ELSE COALESCE(er.max_end_date, er.end_date)
      END AS end_date_eff,
      er.cat_type_approved,
      er.cat_status_edition,
      er.vacant,
      er.active,
      er.user_registration_id,
      er.user_modification_id,
      er.registration_date,
      er.modification_date,
      er.notes,
      CASE
        WHEN er.program_type_alias = 'we_program_type_course' THEN er.own_schedules
        ELSE COALESCE(er.child_schedules, er.own_schedules)
      END AS schedules,

      ----------------------------------------------------------------------
      -- CAMPOS DE ORDENAMIENTO
      ----------------------------------------------------------------------
      CASE 
		  WHEN parent_info.parent_id IS NOT NULL THEN parent_info.parent_start
		  WHEN er.program_type_alias = 'we_program_type_course' THEN er.start_date 
		  ELSE COALESCE(er.min_start_date, er.start_date) 
		END AS sort_family_date,

      COALESCE(parent_info.parent_code, er.global_code) AS sort_family_code,

      CASE WHEN parent_info.parent_id IS NOT NULL THEN 1 ELSE 0 END AS sort_is_child,

      COALESCE(parent_info.sort_order, 999) AS sort_child_order,

	CASE 
	  WHEN er.program_type_alias = 'we_program_type_course' 
	       AND parent_info.parent_id IS NULL 
	  THEN 1
	  WHEN er.program_type_alias = 'we_program_type_course'
	       AND parent_info.parent_id IS NOT NULL 
	       AND parent_info.parent_start::DATE = er.start_date::DATE
	  THEN 0
	  WHEN er.program_type_alias = 'we_program_type_course'
	       AND parent_info.parent_id IS NOT NULL 
	  THEN 1
	  ELSE 0 
	END AS sort_is_loose,

	CASE 
	    WHEN er.program_type_alias = 'we_program_type_course' THEN
	        (SELECT COUNT(*) 
	         FROM public.edition_structure es 
	         WHERE es.child_edition_id = er.edition_num_id)
	    ELSE 0
	END AS parent_count,
	
CASE 
  WHEN er.program_type_alias = 'we_program_type_course' THEN
	(
		CASE WHEN EXISTS (
		     SELECT 1 
		     FROM public.edition_structure es_check
		     JOIN public.program_editions pe_check ON pe_check.edition_num_id = es_check.parent_edition_id
		     WHERE es_check.child_edition_id = er.edition_num_id
		     AND pe_check.start_date::DATE = er.start_date::DATE  -- ✅ Comparar con la fecha del curso
		   ) THEN 1
	  		ELSE 0	
		END
	)
	ELSE 1
END AS has_internal_parent,
CASE 
  WHEN er.program_type_alias <> 'we_program_type_course' THEN
	(
		SELECT 
			concat(pvc.abbreviation,'-',pe_c.global_code,'-',pe_c.specific_code)
	    FROM public.edition_structure es
	    JOIN public.program_editions pe_c ON pe_c.edition_num_id = es.child_edition_id
			INNER JOIN program_versions pvc on pvc.program_version_id = pe_c.program_version_id 
	    WHERE es.parent_edition_id = er.edition_num_id AND pe_c.start_date::DATE = er.start_date::DATE
	    ORDER BY 
	        pe_c.start_date ASC 
	    LIMIT 1
	)
	ELSE concat(er.program_abreviature,'-',er.global_code,'-',er.specific_code)
END AS child_by_date_group_detected,


-- ¿Es un programa padre (no es curso)?
CASE 
  WHEN er.program_type_alias != 'we_program_type_course' THEN 1
  ELSE 0
END AS is_parent_program,

-- Prioridad de ordenamiento compuesta
CASE 
  -- Es un programa padre → prioridad 0
  WHEN er.program_type_alias != 'we_program_type_course' THEN 0
  
  -- Es curso SIN padres (huérfano total) → prioridad 1
  WHEN (SELECT COUNT(*) 
        FROM public.edition_structure es 
        WHERE es.child_edition_id = er.edition_num_id) = 0 THEN 1
  
  -- Es curso CON padre en mismo día (hijo interno) → prioridad 2
  WHEN EXISTS (
     SELECT 1 
     FROM public.edition_structure es_check
     JOIN public.program_editions pe_check ON pe_check.edition_num_id = es_check.parent_edition_id
     WHERE es_check.child_edition_id = er.edition_num_id
     AND pe_check.start_date::DATE = er.start_date::DATE
   ) THEN 2
  
  -- Es curso CON padre externo (otro día) → prioridad 3
  WHEN (SELECT COUNT(*) 
        FROM public.edition_structure es 
        WHERE es.child_edition_id = er.edition_num_id) > 0 THEN 3
  
  ELSE 999
END AS sort_priority

    FROM editions_raw er
    
    LEFT JOIN LATERAL (
    SELECT 
        es.parent_edition_id AS parent_id,
        CASE
            WHEN pe_p.start_date IS NOT NULL AND pe_p.user_modification_id IS NULL THEN pe_p.start_date
            ELSE COALESCE(
                (SELECT MIN(ch.start_date) 
                 FROM public.edition_structure estr2
                 JOIN public.program_editions ch ON ch.edition_num_id = estr2.child_edition_id
                 WHERE estr2.parent_edition_id = pe_p.edition_num_id),
                pe_p.start_date
            )
        END AS parent_start,
        pe_p.global_code     AS parent_code,
        pvs.sort_order       AS sort_order
    FROM public.edition_structure es
    JOIN public.program_editions pe_p ON pe_p.edition_num_id = es.parent_edition_id
    LEFT JOIN public.program_version_structure pvs 
           ON pvs.child_program_version_id = er.program_version_id
          AND pvs.parent_program_version_id = pe_p.program_version_id
    WHERE es.child_edition_id = er.edition_num_id
    ORDER BY 
        (CASE WHEN CASE
            WHEN pe_p.start_date IS NOT NULL AND pe_p.user_modification_id IS NULL THEN pe_p.start_date
            ELSE COALESCE(
                (SELECT MIN(ch.start_date) 
                 FROM public.edition_structure estr2
                 JOIN public.program_editions ch ON ch.edition_num_id = estr2.child_edition_id
                 WHERE estr2.parent_edition_id = pe_p.edition_num_id),
                pe_p.start_date
            )
        END = er.start_date THEN 0 ELSE 1 END) ASC,
        pe_p.start_date ASC 
    LIMIT 1
) parent_info ON true
  ),
-- 4.5) CÁLCULO DE GAPS (excluyendo A5)
editions_calc AS (
    SELECT
        e.*,
        CASE 
            WHEN e.cat_segment = 'A5' THEN NULL
            ELSE (
                e.start_date_eff::DATE - 
                (
                    SELECT e2.start_date_eff::DATE
                    FROM editions e2
                    WHERE e2.program_id = e.program_id
                      AND e2.cat_segment != 'A5'
                      AND e2.start_date_eff < e.start_date_eff
                    ORDER BY e2.start_date_eff DESC
                    LIMIT 1
                )
            )::INTEGER
        END AS calc_da,
        CASE 
            WHEN e.cat_segment = 'A5' THEN NULL
            ELSE (
                (
                    SELECT e2.start_date_eff::DATE
                    FROM editions e2
                    WHERE e2.program_id = e.program_id
                      AND e2.cat_segment != 'A5'
                      AND e2.start_date_eff > e.start_date_eff
                    ORDER BY e2.start_date_eff ASC
                    LIMIT 1
                ) - e.start_date_eff::DATE
            )::INTEGER
        END AS calc_dp
    FROM editions e
),
  -- 5) Filtro y Cálculo de Semana CALENDARIO (Lunes a Domingo)
  filtered AS (
    SELECT
      e.*,
      -- FÓRMULA CORREGIDA:
      -- Calcula la semana basándose en que la semana empieza el Lunes.
      -- ((Día del mes + DíaSemana del 1ro del mes - 2) / 7) + 1
      TRUNC((EXTRACT(DAY FROM e.start_date_eff) + EXTRACT(ISODOW FROM date_trunc('month', e.start_date_eff)) - 2) / 7) + 1 AS week_in_month
    FROM editions_calc e
    WHERE e.start_date_eff IS NOT NULL
      AND EXTRACT(YEAR  FROM e.start_date_eff) = v_year
      AND EXTRACT(MONTH FROM e.start_date_eff) = v_month
  ),
 -- Grafo bidireccional
  all_edges AS (
    SELECT parent_edition_id AS a, child_edition_id AS b 
    FROM public.edition_structure
    UNION ALL
    SELECT child_edition_id, parent_edition_id 
    FROM public.edition_structure
  ),

  -- Expansión recursiva de toda la familia (1 sola recursión)
  family_expansion AS (
    SELECT edition_num_id AS root_id, edition_num_id AS node_id
    FROM filtered

    UNION

    SELECT fe.root_id, ae.b AS node_id
    FROM family_expansion fe
    JOIN all_edges ae ON ae.a = fe.node_id
  ),

  -- Clasifications de PADRES por edición
  family_filter_agg AS (
    SELECT 
      fe.root_id AS edition_num_id,
      string_agg(DISTINCT pe.clasification, '|') AS family_filter_value
    FROM family_expansion fe
    JOIN public.program_editions pe ON pe.edition_num_id = fe.node_id
    JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN public.programs p ON p.program_id = pv.program_id
    JOIN public.catalog cat ON cat.catalog_id = p.cat_type_program
    WHERE cat.alias != 'we_program_type_course'
      AND pe.clasification IS NOT NULL
    GROUP BY fe.root_id
  ),
  -- 6) Semanas (Generamos hasta 6 para cubrir meses largos distribuidos en 6 filas)
  weeks AS (
    SELECT generate_series(1, 6) AS schedule
  )
  -- 7) Resultado final
  SELECT
    w.schedule,
    COALESCE(
      (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'edition_num_id',        f.edition_num_id,
                   'global_code',           f.global_code,
                   'specific_code',         f.specific_code,
					'program_public_label',  f.program_public_label,
                   'program_abreviature',   f.program_abreviature,
                   'teams_link',         f.teams_link,
                   'whatsapp_link',   f.whatsapp_link,
                   'program_line_business', f.program_line_business,
                   'program_line_business_alias', f.program_line_business_alias,
                   'cat_course_category_alias', f.cat_course_category_alias,
                   'cat_course_category_label', f.cat_course_category_label,
                   'version_code',          f.version_code,
                   'program_type',          f.program_type,
                   'program_type_alias',    f.program_type_alias,
                   'program_sessions',      f.program_sessions,
                   'instructor',            f.instructor,
                   'program_version_id',    f.program_version_id,
                   'instructor_id',         f.instructor_id,
                   'clasification',         f.clasification,
                   'cat_segment',           f.cat_segment,
                   'calc_da',               (CASE WHEN f.calc_da IS NOT NULL THEN f.calc_da ELSE 0 END),
                   'calc_dp',               (CASE WHEN f.calc_dp IS NOT NULL THEN f.calc_dp ELSE 0 END),
                   'expedient',             (CASE WHEN f.expedient = 'Y' THEN true ELSE false END),
                   'preconfirmation',       (CASE WHEN f.preconfirmation = 'Y' THEN true ELSE false END),
                   'confirmation',          (CASE WHEN f.confirmation = 'Y' THEN true ELSE false END),
                   'upgrade',               (CASE WHEN f.upgrade = 'Y' THEN true ELSE false END),
                   'new_methodology',       (CASE WHEN f.new_methodology = 'Y' THEN true ELSE false END),
                   'active',                (CASE WHEN f.active = 'Y' THEN true ELSE false END),
                   'start_date',            f.start_date_eff,
                   'end_date',              f.end_date_eff,
                   'cat_type_approved',     f.cat_type_approved,
                   'cat_status_edition',    f.cat_status_edition,
                   'vacant',                f.vacant,
                   'user_registration_id',  f.user_registration_id,
                   'user_modification_id',  f.user_modification_id,
                   'registration_date',     f.registration_date,
                   'modification_date',     f.modification_date,
                   'notes',                 f.notes,
                   'schedules',             f.schedules,
'family_filter_value',   ffa.family_filter_value,
                   'tree_detail',
                   CASE
                      -- CASO 1: Es un CURSO
                      WHEN f.program_type_alias = 'we_program_type_course' THEN
                        COALESCE(
                          (
                            SELECT jsonb_agg(
                                     jsonb_build_object(
                                       'parent_edition_id',     p.edition_num_id,
                                       'parent_global_code',    p.global_code,
                                       'parent_clasification',  p.clasification,
                                       'active',  p.active,
                                       'parent_abbreviation',   pv_parent.abbreviation,
                                       'children',
                                       COALESCE(
                                         (
                                           SELECT jsonb_agg(
                                                    jsonb_build_object(
                                                      'edition_num_id',  ch.edition_num_id,
                                                      'global_code',     ch.global_code,
                                                      'clasification',   ch.clasification,
                                                      'program_version_id',    pv_child.program_version_id,
                                                      'abbreviation',    pv_child.abbreviation,
                                                      'program_public_label',    pv_child.description,
                                                      'start_date',      ch.start_date,
                                                      'end_date',        ch.end_date,
                                                      'active',        	ch.active,
                                                      'instructor', INITCAP(CONCAT_WS(' ', perch.first_name, perch.last_name)),
                                                      'schedules',
                                                      CASE
                                                        WHEN ch.cat_day_combination_id IS NULL AND ch.cat_hour_combination_id IS NULL
                                                        THEN '[]'::jsonb
                                                        ELSE jsonb_build_array(
                                                          jsonb_build_object(
                                                            'cat_day_combination_id',   ch.cat_day_combination_id,
                                                            'day_combination_label',    dayc2.description,
                                                            'cat_hour_combination_id',  ch.cat_hour_combination_id,
                                                            'hour_combination_label',   hourc2.description
                                                          )
                                                        )
                                                      END
                                                    )
                                                    ORDER BY ch.start_date, ch.global_code
                                                  )
                                           FROM public.edition_structure es2
                                           JOIN public.program_editions ch ON ch.edition_num_id = es2.child_edition_id
                                           JOIN public.program_versions pv_child ON pv_child.program_version_id = ch.program_version_id
                                           LEFT JOIN public.instructors ich ON ich.instructor_id = ch.instructor_id
                                           LEFT JOIN public.persons perch ON perch.person_id = ich.person_id
                                           LEFT JOIN public.catalog dayc2 ON dayc2.catalog_id = ch.cat_day_combination_id
                                           LEFT JOIN public.catalog hourc2 ON hourc2.catalog_id = ch.cat_hour_combination_id
                                           WHERE es2.parent_edition_id = p.edition_num_id
                                         ),
                                         '[]'::jsonb
                                       )
                                     )
                                     ORDER BY p.global_code
                                   )
                            FROM public.edition_structure es
                            JOIN public.program_editions p ON p.edition_num_id = es.parent_edition_id
                            JOIN public.program_versions pv_parent ON pv_parent.program_version_id = p.program_version_id
                            WHERE es.child_edition_id = f.edition_num_id
                          ),
                          '[]'::jsonb
                        )
                      -- CASO 2: NO es curso
                      ELSE
                        COALESCE(
                          (
                            SELECT jsonb_agg(
                                     jsonb_build_object(
                                       'edition_num_id',  ch.edition_num_id,
                                       'global_code',     ch.global_code,
                                       'specific_code',   ch.specific_code,
                                       'active',          ch.active,
                                       'clasification',   ch.clasification,
                                       'abbreviation',    pv_child.abbreviation,
                                       'program_public_label',    pv_child.description,
                                       'start_date',      ch.start_date,
                                       'end_date',        ch.end_date,
                                       'instructor', INITCAP(CONCAT_WS(' ', perch.first_name, perch.last_name)),
                                       'schedules',
                                       CASE
                                         WHEN ch.cat_day_combination_id IS NULL AND ch.cat_hour_combination_id IS NULL
                                         THEN '[]'::jsonb
                                         ELSE jsonb_build_array(
                                           jsonb_build_object(
                                             'cat_day_combination_id',   ch.cat_day_combination_id,
                                             'day_combination_label',    dayc2.description,
                                             'cat_hour_combination_id',  ch.cat_hour_combination_id,
                                             'hour_combination_label',   hourc2.description
                                           )
                                         )
                                       END
                                     )
                                     ORDER BY ch.start_date, ch.global_code
                                   )
                            FROM public.edition_structure es
                            JOIN public.program_editions ch ON ch.edition_num_id = es.child_edition_id
                            JOIN public.program_versions pv_child ON pv_child.program_version_id = ch.program_version_id
                            LEFT JOIN public.instructors ich ON ich.instructor_id = ch.instructor_id
                            LEFT JOIN public.persons perch ON perch.person_id = ich.person_id
                            LEFT JOIN public.catalog dayc2 ON dayc2.catalog_id = ch.cat_day_combination_id
                            LEFT JOIN public.catalog hourc2 ON hourc2.catalog_id = ch.cat_hour_combination_id
                            WHERE es.parent_edition_id = f.edition_num_id
                          ),
                          '[]'::jsonb
                        )
                    END
                 )
				  ORDER BY
				  -- ============================================================
				  -- ORDENAMIENTO SEGÚN LÓGICA JERÁRQUICA SOLICITADA
				  -- ============================================================
				  
				  -- 1. FECHA DE INICIO (primario)
				  f.start_date_eff ASC,
				  
				  -- 2. JERARQUÍA INTERNA DETECTADA
				  f.has_internal_parent ASC,
				  
				  -- ============================================================
				  -- BIFURCACIÓN SEGÚN has_internal_parent
				  -- ============================================================
				  
				  -- 3a. SI has_internal_parent = 0 (sin padre interno)
				  --     → Aplicar JERARQUÍA EXTERNA
				  CASE 
				    WHEN f.has_internal_parent = 0 THEN
				      CASE 
				        WHEN f.parent_count = 0 THEN 0  -- Huérfano total (primero)
				        WHEN f.parent_count > 0 THEN 1  -- Tiene padre externo (después)
				        ELSE 999
				      END
				    ELSE 999  -- No aplica este criterio
				  END ASC,
				  
				  -- 3b. SI has_internal_parent = 1 (con padre interno)
				  --     → PRIMERO: Agrupar por familia (child_by_date_group_detected)
				  --     Esto evita que se mezclen diferentes programas padres con sus hijos
				  CASE 
				    WHEN f.has_internal_parent = 1 THEN 
				      COALESCE(f.child_by_date_group_detected, 'ZZZZZZZZZ')
				    ELSE 'ZZZZZZZZZ'  -- No aplica, va al final
				  END ASC,
				  
				  -- 3c. LUEGO dentro de cada familia: Padre arriba, hijo(s) abajo
				  CASE 
				    WHEN f.has_internal_parent = 1 THEN
				      CASE 
				        -- Es el programa padre
				        WHEN f.is_parent_program = 1 THEN 0
				        
				        -- Es curso hijo con 1 solo padre
				        WHEN f.parent_count = 1 THEN 1
				        
				        -- Es curso hijo con múltiples padres
				        WHEN f.parent_count > 1 THEN 2
				        
				        ELSE 999
				      END
				    ELSE 999  -- No aplica este criterio
				  END ASC,
				  
CASE 
  WHEN f.program_type_alias = 'we_program_type_diploma' THEN 1
  WHEN f.program_type_alias = 'we_program_type_pee' THEN 2
  WHEN f.program_type_alias = 'we_program_type_specialization' THEN 3
  ELSE 4
END ASC,
				  -- 4. Orden interno de hijos (si hay varios hijos del mismo padre)
				  COALESCE(f.sort_child_order, 999) ASC,
				  
				  -- 5. Desempate final
				  f.global_code ASC
               )
        FROM filtered f
        LEFT JOIN family_filter_agg ffa ON ffa.edition_num_id = f.edition_num_id

        WHERE f.week_in_month = w.schedule
      ),
      '[]'::jsonb
    ) AS items
  FROM weeks w
  ORDER BY w.schedule;
END;
$procedure$
