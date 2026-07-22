-- =====================================================================
-- NUEVA METODOLOGIA POR EDICION (flag Y/N en el cronograma)
-- =====================================================================
-- Checkbox en el grupo SEGUIMIENTO de /producto/cronograma para marcar
-- que un curso tiene nueva metodologia. Solo visible/editable ahi
-- (no se muestra en Cronograma Vista). Mismo patron que expedient/upgrade:
-- columna varchar(1) 'Y'/'N', el SP de listado la expone como boolean.
--
-- Incluye la redefinicion completa de los 4 SP afectados:
--   sp_edition_update        -> persiste el flag (COALESCE, no pisa si falta)
--   sp_edition_get           -> lo devuelve en el detalle
--   sp_edition_by_week_list  -> lo expone en la vista mensual (boolean)
--   sp_edition_list          -> lo expone en la vista historica (boolean)
-- Script idempotente: se puede re-ejecutar sin efecto adicional.
-- =====================================================================

ALTER TABLE public.program_editions
  ADD COLUMN IF NOT EXISTS new_methodology varchar(1) DEFAULT 'N';

COMMENT ON COLUMN public.program_editions.new_methodology IS
  'Y = la edicion aplica nueva metodologia (checkbox SEGUIMIENTO del cronograma). Default N.';

CREATE OR REPLACE PROCEDURE public.sp_edition_update(IN p_edition jsonb, IN p_user_id jsonb, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
  v_edition_id         int;
  v_rows               int;
  v_start_date         date;
  v_end_date           date;
  v_instructor_id      int;
  v_vacant             int;
  v_program_version_id int;
  v_current_pv_id      int;
  v_user_id_int        int := p_user_id::int;
BEGIN
  IF p_cur IS NULL THEN
    p_cur := 'cur_sp_edition_update';
  END IF;

  -- ══════════════════════════════════════════
  -- 0. VALIDACIÓN DE PERMISOS
  -- ══════════════════════════════════════════
  PERFORM 1
  FROM public.user_roles ur
  INNER JOIN public.rol r   ON r.rol_id   = ur.rol_id
  INNER JOIN public.users u ON u.user_id  = ur.user_id
  WHERE ur.user_id = v_user_id_int
    AND u.active   = 'Y'
    AND r.alias   IN ('ADMIN', 'PRODUCTO');

  IF NOT FOUND THEN
    OPEN p_cur FOR SELECT 2 AS result,
      'No tiene permisos para modificar ediciones. Se requiere rol ADMIN o PRODUCTO.' AS message;
    RETURN;
  END IF;

  -- ══════════════════════════════════════════
  -- 1. EXTRACCIÓN Y VALIDACIONES FAIL FAST
  -- ══════════════════════════════════════════
  v_edition_id := NULLIF(p_edition->>'edition_num_id', '')::int;

  IF v_edition_id IS NULL THEN
    OPEN p_cur FOR SELECT 2 AS result, 'El campo edition_num_id es obligatorio.' AS message;
    RETURN;
  END IF;

  -- Edición debe existir
  SELECT program_version_id INTO v_current_pv_id
  FROM public.program_editions
  WHERE edition_num_id = v_edition_id;

  IF NOT FOUND THEN
    OPEN p_cur FOR SELECT 2 AS result,
      'No existe la edición con ID ' || v_edition_id || '.' AS message;
    RETURN;
  END IF;

  v_start_date         := NULLIF(p_edition->>'start_date', '')::date;
  v_end_date           := NULLIF(p_edition->>'end_date', '')::date;
  v_instructor_id      := NULLIF(p_edition->>'instructor_id', '')::int;
  v_vacant             := NULLIF(p_edition->>'vacant', '')::int;
  v_program_version_id := COALESCE(NULLIF(p_edition->>'program_version_id', '')::int, v_current_pv_id);

  -- Coherencia de fechas
  IF v_start_date IS NOT NULL AND v_end_date IS NOT NULL AND v_end_date < v_start_date THEN
    OPEN p_cur FOR SELECT 2 AS result,
      'La fecha de fin no puede ser anterior a la fecha de inicio.' AS message;
    RETURN;
  END IF;

  -- Vacantes no negativas
  IF v_vacant IS NOT NULL AND v_vacant < 0 THEN
    OPEN p_cur FOR SELECT 2 AS result, 'El número de vacantes no puede ser negativo.' AS message;
    RETURN;
  END IF;

  -- Instructor debe existir
  IF v_instructor_id IS NOT NULL THEN
    PERFORM 1 FROM public.instructors WHERE instructor_id = v_instructor_id;
    IF NOT FOUND THEN
      OPEN p_cur FOR SELECT 2 AS result, 'El docente indicado no existe.' AS message;
      RETURN;
    END IF;
  END IF;

  -- Conflicto de horario instructor (excluir la misma edición)
  IF v_instructor_id IS NOT NULL
     AND NULLIF(p_edition->>'cat_day_combination_id', '')::int IS NOT NULL
     AND NULLIF(p_edition->>'cat_hour_combination_id', '')::int IS NOT NULL
     AND v_start_date IS NOT NULL
  THEN
    PERFORM 1 FROM public.program_editions
    WHERE instructor_id           = v_instructor_id
      AND start_date              = v_start_date
      AND cat_day_combination_id  = NULLIF(p_edition->>'cat_day_combination_id', '')::int
      AND cat_hour_combination_id = NULLIF(p_edition->>'cat_hour_combination_id', '')::int
      AND edition_num_id         <> v_edition_id;
    IF FOUND THEN
      OPEN p_cur FOR SELECT 2 AS result,
        'El docente ya tiene otra edición registrada con el mismo horario y fecha de inicio.' AS message;
      RETURN;
    END IF;
  END IF;

  -- Unicidad global_code
  IF NULLIF(p_edition->>'global_code', '') IS NOT NULL THEN
    PERFORM 1 FROM public.program_editions
    WHERE global_code        = NULLIF(p_edition->>'global_code', '')::varchar
      AND program_version_id = v_program_version_id
      AND edition_num_id    <> v_edition_id;
    IF FOUND THEN
      OPEN p_cur FOR SELECT 2 AS result,
        'Ya existe otra edición con el mismo código global para esta versión de programa.' AS message;
      RETURN;
    END IF;
  END IF;

  -- Unicidad specific_code
  IF NULLIF(p_edition->>'specific_code', '') IS NOT NULL THEN
    PERFORM 1 FROM public.program_editions
    WHERE specific_code      = NULLIF(p_edition->>'specific_code', '')::varchar
      AND program_version_id = v_program_version_id
      AND edition_num_id    <> v_edition_id;
    IF FOUND THEN
      OPEN p_cur FOR SELECT 2 AS result,
        'Ya existe otra edición con el mismo código anual para esta versión de programa.' AS message;
      RETURN;
    END IF;
  END IF;

  -- ══════════════════════════════════════════
  -- 2. VALIDACIÓN: Conflicto cronológico como primer hijo
  --    Si se está cambiando la fecha de inicio Y esta edición
  --    es el primer módulo de algún padre, verificar que la nueva
  --    fecha no supere la fecha de inicio de los módulos siguientes.
  -- ══════════════════════════════════════════
  IF v_start_date IS NOT NULL THEN
    PERFORM 1
    FROM public.edition_structure es_self
    INNER JOIN public.edition_structure es_sibling
        ON  es_sibling.parent_edition_id = es_self.parent_edition_id
        AND es_sibling.child_edition_id  <> v_edition_id
    INNER JOIN public.program_editions pe_sibling
        ON  pe_sibling.edition_num_id    = es_sibling.child_edition_id
    WHERE es_self.child_edition_id = v_edition_id
      -- Solo si es el primer hijo (sort_order mínimo del padre)
      AND es_self.sort_order = (
          SELECT MIN(es2.sort_order)
          FROM public.edition_structure es2
          WHERE es2.parent_edition_id = es_self.parent_edition_id
      )
      -- La nueva fecha supera a algún hermano posterior
      AND es_sibling.sort_order > es_self.sort_order
      AND v_start_date > pe_sibling.start_date;

    IF FOUND THEN
      OPEN p_cur FOR SELECT 2 AS result,
        'La nueva fecha de inicio supera la fecha de módulos posteriores en el programa padre. Modifique la estructura completa desde la gestión de árbol.' AS message;
      RETURN;
    END IF;
  END IF;

  -- ══════════════════════════════════════════
  -- 3. ACTUALIZACIÓN
  -- ══════════════════════════════════════════
  UPDATE public.program_editions
  SET
    program_version_id      = COALESCE(NULLIF(p_edition->>'program_version_id', '')::int, program_version_id),
    instructor_id           = COALESCE(NULLIF(p_edition->>'instructor_id', '')::int, instructor_id),
    start_date              = COALESCE(v_start_date, start_date),
    end_date                = COALESCE(v_end_date, end_date),
    cat_type_approved       = COALESCE(NULLIF(p_edition->>'cat_type_approved', '')::int, cat_type_approved),
    active                  = COALESCE(NULLIF(p_edition->>'active', '')::varchar, active),
    vacant                  = COALESCE(v_vacant, vacant),
    cat_status_edition      = COALESCE(NULLIF(p_edition->>'cat_status_edition', '')::int, cat_status_edition),
    notes                   = p_edition->>'notes',
    global_code             = COALESCE(NULLIF(p_edition->>'global_code', '')::varchar, global_code),
    specific_code           = COALESCE(NULLIF(p_edition->>'specific_code', '')::varchar, specific_code),
    expedient               = COALESCE(NULLIF(p_edition->>'expedient', '')::varchar, expedient),
    upgrade                 = COALESCE(NULLIF(p_edition->>'upgrade', '')::varchar, upgrade),
    cat_segment             = COALESCE(NULLIF(p_edition->>'cat_segment_id', '')::int, cat_segment),
    confirmation            = COALESCE(NULLIF(p_edition->>'confirmation', '')::varchar, confirmation),
    preconfirmation         = COALESCE(NULLIF(p_edition->>'preconfirmation', '')::varchar, preconfirmation),
    new_methodology         = COALESCE(NULLIF(p_edition->>'new_methodology', '')::varchar, new_methodology),
    user_modification_id    = v_user_id_int,
    modification_date       = NOW(),
    cat_day_combination_id  = CASE WHEN p_edition ? 'cat_day_combination_id'
                                   THEN NULLIF(p_edition->>'cat_day_combination_id', '')::int
                                   ELSE cat_day_combination_id END,
    cat_hour_combination_id = CASE WHEN p_edition ? 'cat_hour_combination_id'
                                   THEN NULLIF(p_edition->>'cat_hour_combination_id', '')::int
                                   ELSE cat_hour_combination_id END,
    whatsapp_link           = CASE WHEN p_edition ? 'whatsapp_link'
                                   THEN p_edition->>'whatsapp_link'
                                   ELSE whatsapp_link END,
    teams_link              = CASE WHEN p_edition ? 'teams_link'
                                   THEN p_edition->>'teams_link'
                                   ELSE teams_link END
  WHERE edition_num_id = v_edition_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows > 0 THEN
    OPEN p_cur FOR SELECT 1 AS result, 'Edición actualizada correctamente.' AS message;
  ELSE
    OPEN p_cur FOR SELECT 2 AS result, 'No se encontró la edición a actualizar.' AS message;
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    OPEN p_cur FOR SELECT 0 AS result, SQLERRM AS message;
END;
$procedure$;

CREATE OR REPLACE PROCEDURE public.sp_edition_get(IN p_edition_num_id integer, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
BEGIN
  IF p_cur IS NULL THEN
    p_cur := 'cur_sp_edition_get';
  END IF;

  OPEN p_cur FOR
    SELECT
      pe.edition_num_id,
      pe.global_code           AS codigo_global,
      pe.specific_code         AS codigo_especifico,
      pv.abbreviation          AS version_abreviatura,
      pe.expedient             AS expediente,
      to_jsonb(i)              AS docente,
      pe.preconfirmation       AS preconfirmacion,
      pe.confirmation          AS confirmacion,
      pe.whatsapp_link,
      pe.teams_link,
      pe.new_methodology,
      pe.program_version_id,
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
      /*(
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'schedule_id', es.schedule_id,
                   'edition_num_id', es.edition_num_id,
                   'cat_day_id', es.cat_day_id,
                   'start_time', es.start_time,
                   'end_time', es.end_time
                 )
                 ORDER BY es.cat_day_id, es.start_time
               )
        FROM public.edition_schedules es
        WHERE es.edition_num_id = pe.edition_num_id
      )*/
	cott.description AS days,
	coti.description AS hours
    FROM public.program_editions pe
    JOIN public.program_versions pv
      ON pv.program_version_id = pe.program_version_id
    LEFT JOIN public.instructors i
      ON i.instructor_id = pe.instructor_id
	left JOIN public.catalog cott on cott.catalog_id = pe.cat_day_combination_id
	left JOIN public.catalog coti on coti.catalog_id = pe.cat_hour_combination_id
    WHERE pe.edition_num_id = p_edition_num_id;
END;
$procedure$;

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
$procedure$;

CREATE OR REPLACE PROCEDURE public.sp_edition_list(IN p_filters jsonb, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
    -- Filtros simples
    v_date_from             date;
    v_date_to               date;
	v_clasification_arr		text[];
    v_program_version_id    int;

    -- Filtros arrays
    v_instructor_ids        int[];
    v_type_program_ids      int[];
    v_category_ids          int[];
    v_day_combination_ids   int[];
    v_hour_combination_ids  int[];
    v_segment_ids           int[];
    v_course_category_ids   int[]; 
    v_model_modality_ids   int[]; 

    -- IDs de segmentos (OPTIMIZACIÓN CLAVE)
    v_seg_id_A1 int;
    v_seg_id_A2 int;
    v_seg_id_A5 int;
    v_seg_id_A6 int;

BEGIN
    IF p_cur IS NULL THEN
        p_cur := 'cur_sp_edition_list';
    END IF;

    -- =========================================================================
    -- PRE-CARGA DE IDS DE SEGMENTOS
    -- =========================================================================
    SELECT catalog_id INTO v_seg_id_A1 
    FROM public.catalog 
    WHERE alias = 'A1' OR description = 'A1' 
    LIMIT 1;

    SELECT catalog_id INTO v_seg_id_A2 
    FROM public.catalog 
    WHERE alias = 'A2' OR description = 'A2' 
    LIMIT 1;

    SELECT catalog_id INTO v_seg_id_A5 
    FROM public.catalog 
    WHERE alias = 'A5' OR description = 'A5' 
    LIMIT 1;

    SELECT catalog_id INTO v_seg_id_A6 
    FROM public.catalog 
    WHERE alias = 'A6' OR description = 'A6' 
    LIMIT 1;

    -- =========================================================================
    -- EXTRACCIÓN DE FILTROS
    -- =========================================================================
    
    -- Filtros simples
    v_date_from            := (p_filters->>'date_from')::date;
    v_date_to              := (p_filters->>'date_to')::date;
v_clasification_arr    := string_to_array((p_filters->>'clasification'), '|');
    v_program_version_id   := (p_filters->>'program_version_id')::int;

    -- Filtros arrays
    v_instructor_ids := ARRAY(
        SELECT (x->>'value')::int 
        FROM jsonb_array_elements(p_filters->'instructores_seleccionados') x
    );
    IF array_length(v_instructor_ids, 1) IS NULL THEN 
        v_instructor_ids := NULL; 
    END IF;

    v_type_program_ids := ARRAY(
        SELECT (x->>'value')::int 
        FROM jsonb_array_elements(p_filters->'type_program_ids') x
    );
    IF array_length(v_type_program_ids, 1) IS NULL THEN 
        v_type_program_ids := NULL; 
    END IF;

    v_category_ids := ARRAY(
        SELECT (x->>'value')::int 
        FROM jsonb_array_elements(p_filters->'category_ids') x
    );
    IF array_length(v_category_ids, 1) IS NULL THEN 
        v_category_ids := NULL; 
    END IF;

    v_day_combination_ids := ARRAY(
        SELECT (x->>'value')::int 
        FROM jsonb_array_elements(p_filters->'combination_days_ids') x
    );
    IF array_length(v_day_combination_ids, 1) IS NULL THEN 
        v_day_combination_ids := NULL; 
    END IF;

    v_hour_combination_ids := ARRAY(
        SELECT (x->>'value')::int 
        FROM jsonb_array_elements(p_filters->'hour_combination_ids') x
    );
    IF array_length(v_hour_combination_ids, 1) IS NULL THEN 
        v_hour_combination_ids := NULL; 
    END IF;

    v_segment_ids := ARRAY(
        SELECT (x->>'value')::int 
        FROM jsonb_array_elements(p_filters->'segment_ids') x
    );
    IF array_length(v_segment_ids, 1) IS NULL THEN 
        v_segment_ids := NULL; 
    END IF;

    v_course_category_ids := ARRAY(
        SELECT (x->>'value')::int 
        FROM jsonb_array_elements(p_filters->'course_category_ids') x
    );
    IF array_length(v_course_category_ids, 1) IS NULL THEN 
        v_course_category_ids := NULL; 
    END IF;


    v_model_modality_ids := ARRAY(
        SELECT (x->>'value')::int 
        FROM jsonb_array_elements(p_filters->'model_modality_ids') x
    );
    IF array_length(v_model_modality_ids, 1) IS NULL THEN 
        v_model_modality_ids := NULL; 
    END IF;

    -- =========================================================================
    -- CONSULTA PRINCIPAL
    -- =========================================================================
    
OPEN p_cur FOR
WITH RECURSIVE
child_agg AS (
        SELECT
            estr.parent_edition_id,
            MIN(ch.start_date) AS min_start_date,
            MAX(ch.end_date)   AS max_end_date,
            STRING_AGG(
				  DISTINCT INITCAP(CONCAT(per.first_name, ' ', per.last_name)),
				  ', '
				) AS instructors,
            array_agg(DISTINCT ch.instructor_id) FILTER (WHERE ch.instructor_id IS NOT NULL) AS child_instructor_ids
        FROM public.edition_structure estr
        JOIN public.program_editions ch ON ch.edition_num_id = estr.child_edition_id
        LEFT JOIN public.instructors i ON i.instructor_id = ch.instructor_id
        LEFT JOIN public.persons per ON per.person_id = i.person_id
        GROUP BY estr.parent_edition_id
    ),
    -- Insertar después de child_agg en sp_edition_list
child_flags AS (
    SELECT
        estr.parent_edition_id,
        CASE WHEN BOOL_AND(ch.expedient = 'Y') THEN 'Y' ELSE 'N' END AS expedient_agg,
        CASE WHEN BOOL_AND(ch.upgrade = 'Y') THEN 'Y' ELSE 'N' END AS upgrade_agg,
        CASE WHEN BOOL_AND(ch.preconfirmation = 'Y') THEN 'Y' ELSE 'N' END AS preconfirmation_agg,
        CASE WHEN BOOL_AND(ch.confirmation = 'Y') THEN 'Y' ELSE 'N' END AS confirmation_agg
    FROM public.edition_structure estr
    JOIN public.program_editions ch ON ch.edition_num_id = estr.child_edition_id
    GROUP BY estr.parent_edition_id
),
    -- Clasificaciones de padres
    parents_info AS (
        SELECT 
            es.child_edition_id,
            array_agg(parent.clasification) FILTER (WHERE parent.clasification IS NOT NULL) as parent_clasifications
        FROM public.edition_structure es
        JOIN public.program_editions parent ON parent.edition_num_id = es.parent_edition_id
        GROUP BY es.child_edition_id
    ),
    
    -- Horarios de hijos
    child_combos AS (
    SELECT
        parent_edition_id,
        jsonb_agg(schedule ORDER BY sort_order) AS schedules
    FROM (
        SELECT DISTINCT
            estr.parent_edition_id,
            estr.sort_order,
            jsonb_build_object(
                'cat_day_combination_id',    ch.cat_day_combination_id,
                'day_combination_label',     dayc.description,
                'cat_hour_combination_id',   ch.cat_hour_combination_id,
                'hour_combination_label',    hourc.description,
                'active',                    (CASE WHEN ch.active = 'Y' THEN true ELSE false END),
                'specific_code',             ch.specific_code
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
    
    -- Conteo de ediciones por programa
    edition_count AS (
        SELECT
            pv.program_id,
            COUNT(*) AS total_editions
        FROM public.program_editions pe
        JOIN public.program_versions pv ON pe.program_version_id = pv.program_version_id
        GROUP BY pv.program_id
    ),

    -- Ediciones con cálculo de segmentos
    editions_raw AS (
        SELECT
            pe.edition_num_id,
            p.program_id,
            pe.global_code,
            pe.specific_code,
            pv.abbreviation                AS program_abreviature,
            cot.description                AS program_line_business,
            cot.alias                      AS program_line_business_alias,
            ccat.alias                     AS cat_course_category_alias,
            ccat.description               AS cat_course_category_label,
            cotm.alias                     AS cat_model_modality_alias,
            cotm.description               AS cat_model_modality_label,
            cotm.catalog_id         AS cat_model_modality_id, 
            pv.cat_course_category         AS cat_course_category_id, 
            cat.description                AS program_type,
            cat.alias                      AS program_type_alias,
            pv.sessions                    AS program_sessions,
            pv.version_code,
			-- Dentro de editions_raw
			COALESCE(cf.expedient_agg, pe.expedient) AS expedient,
			COALESCE(cf.upgrade_agg, pe.upgrade) AS upgrade,
			COALESCE(cf.preconfirmation_agg, pe.preconfirmation) AS preconfirmation,
			COALESCE(cf.confirmation_agg, pe.confirmation) AS confirmation,
            pe.new_methodology,
            pe.clasification,
            pi.parent_clasifications,
            INITCAP(CONCAT(per.first_name, ' ', per.last_name)) AS instructor_base,
            pe.program_version_id,
            pe.instructor_id,
            p.cat_type_program             AS cat_type_program_id,
            p.cat_category                 AS cat_category_id,
            pe.cat_day_combination_id,
            pe.cat_hour_combination_id,
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
            ca.child_instructor_ids,
            cc.schedules AS child_schedules,
			
			-- parent_count
			CASE 
			    WHEN cat.alias = 'we_program_type_course' THEN
			        (SELECT COUNT(*) 
			         FROM public.edition_structure es 
			         WHERE es.child_edition_id = pe.edition_num_id)
			    ELSE 0
			END AS parent_count,
			
			-- has_internal_parent
			CASE 
			    WHEN cat.alias = 'we_program_type_course' THEN
			        (
			            CASE WHEN EXISTS (
			                 SELECT 1 
			                 FROM public.edition_structure es_check
			                 JOIN public.program_editions pe_check ON pe_check.edition_num_id = es_check.parent_edition_id
			                 WHERE es_check.child_edition_id = pe.edition_num_id
			                 AND pe_check.start_date::DATE = CASE 
			                     WHEN cat.alias = 'we_program_type_course' THEN pe.start_date::DATE
			                     ELSE COALESCE(ca.min_start_date::DATE, pe.start_date::DATE)
			                 END
			               ) THEN 1
			                ELSE 0	
			            END
			        )
			    ELSE 1
			END AS has_internal_parent,
            CASE
                WHEN pe.cat_day_combination_id IS NULL AND pe.cat_hour_combination_id IS NULL THEN NULL
                ELSE jsonb_build_array(
                    jsonb_build_object(
                        'cat_day_combination_id',    pe.cat_day_combination_id,
                        'day_combination_label',     dayc.description,
                        'cat_hour_combination_id',   pe.cat_hour_combination_id,
                        'hour_combination_label',    hourc.description
                    )
                )
            END AS own_schedules,

            -- Etiqueta visual del segmento
            COALESCE(cota.description,
                CASE 
                    WHEN pe.active = 'N' THEN 'A5'
                    WHEN COALESCE(ec.total_editions, 0) <= 2 THEN 'A6'
                    ELSE 
                        CASE 
                            WHEN (cat.alias = 'we_program_type_course' AND NOT EXISTS (
                                SELECT 1 FROM public.edition_structure es 
                                WHERE es.child_edition_id = pe.edition_num_id
                            )) OR cat.alias <> 'we_program_type_course' 
                            THEN 'A1'
                            ELSE 'A2'
                        END
                END
            ) AS cat_segment,

            -- ID efectivo para filtrado (USANDO VARIABLES)
            COALESCE(pe.cat_segment, 
                CASE
                    WHEN pe.active = 'N' 
                        THEN v_seg_id_A5
                    WHEN COALESCE(ec.total_editions, 0) <= 2 
                        THEN v_seg_id_A6
                    ELSE
                        CASE 
                            WHEN (cat.alias = 'we_program_type_course' AND NOT EXISTS (
                                SELECT 1 FROM public.edition_structure es 
                                WHERE es.child_edition_id = pe.edition_num_id
                            )) OR cat.alias <> 'we_program_type_course' 
                            THEN v_seg_id_A1
                            ELSE v_seg_id_A2
                        END
                END
            ) as cat_segment_id_eff

        FROM public.program_editions pe
        JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
        LEFT JOIN public.catalog ccat ON ccat.catalog_id = pv.cat_course_category
        JOIN public.programs p ON p.program_id = pv.program_id
        JOIN public.catalog cat ON cat.catalog_id = p.cat_type_program
        JOIN public.catalog cot ON cot.catalog_id = p.cat_category
        JOIN public.catalog cotm ON cotm.catalog_id = p.cat_model_modality
        LEFT JOIN public.catalog cota ON cota.catalog_id = pe.cat_segment
        LEFT JOIN public.instructors i ON i.instructor_id = pe.instructor_id
        LEFT JOIN public.persons per ON per.person_id = i.person_id
		LEFT JOIN child_flags cf ON cf.parent_edition_id = pe.edition_num_id
        LEFT JOIN child_agg ca ON ca.parent_edition_id = pe.edition_num_id
        LEFT JOIN child_combos cc ON cc.parent_edition_id = pe.edition_num_id
        LEFT JOIN parents_info pi ON pi.child_edition_id = pe.edition_num_id
        LEFT JOIN public.catalog dayc ON dayc.catalog_id = pe.cat_day_combination_id
        LEFT JOIN public.catalog hourc ON hourc.catalog_id = pe.cat_hour_combination_id
        LEFT JOIN edition_count ec ON ec.program_id = p.program_id
    ),

    editions_base AS (
    SELECT
        er.*,
        -- CALCULO DE FECHAS EFECTIVAS
        CASE 
            WHEN er.program_type_alias = 'we_program_type_course' THEN er.start_date 
            ELSE (
                CASE
                    WHEN er.start_date is not null and er.user_modification_id is null THEN er.start_date
                    ELSE COALESCE(er.min_start_date, er.start_date)
                END
            )
        END AS start_date_eff,
        
        CASE WHEN er.program_type_alias = 'we_program_type_course' 
            THEN er.end_date 
            ELSE COALESCE(er.max_end_date, er.end_date) 
        END AS end_date_eff,
        
        CASE WHEN er.program_type_alias = 'we_program_type_course' 
            THEN er.instructor_base 
            ELSE COALESCE(er.child_instructors, er.instructor_base) 
        END AS instructor,
        
        CASE WHEN er.program_type_alias = 'we_program_type_course' 
            THEN er.own_schedules 
            ELSE COALESCE(er.child_schedules, er.own_schedules) 
        END AS schedules
    FROM editions_raw er
),

-- PASO 2: Ahora calcular campos que dependen de start_date_eff
editions AS (
    SELECT
        eb.*,
        
        COALESCE(
            parent_sort.parent_start, 
            CASE WHEN eb.program_type_alias = 'we_program_type_course' 
                THEN eb.start_date 
                ELSE COALESCE(eb.min_start_date, eb.start_date) 
            END
        ) AS sort_family_date,
        
        COALESCE(parent_sort.parent_code, eb.global_code) AS sort_family_code,
        CASE WHEN parent_sort.parent_id IS NOT NULL THEN 1 ELSE 0 END AS sort_is_child,
        COALESCE(parent_sort.sort_order, 999) AS sort_child_order,
        CASE WHEN eb.program_type_alias = 'we_program_type_course' AND parent_sort.parent_id IS NULL 
            THEN 1 ELSE 0 
        END AS sort_is_loose,
        
        -- child_by_date_group_detected (AHORA SÍ PUEDE USAR start_date_eff)
        CASE 
            WHEN eb.program_type_alias <> 'we_program_type_course' THEN
                (
                    SELECT 
                        concat(pvc.abbreviation,'-',pe_c.global_code,'-',pe_c.specific_code)
                    FROM public.edition_structure es
                    JOIN public.program_editions pe_c ON pe_c.edition_num_id = es.child_edition_id
                    INNER JOIN program_versions pvc on pvc.program_version_id = pe_c.program_version_id 
                    WHERE es.parent_edition_id = eb.edition_num_id 
                    AND pe_c.start_date::DATE = eb.start_date_eff::DATE
                    ORDER BY pe_c.start_date ASC 
                    LIMIT 1
                )
            ELSE concat(eb.program_abreviature,'-',eb.global_code,'-',eb.specific_code)
        END AS child_by_date_group_detected,
        
        -- is_parent_program
        CASE 
            WHEN eb.program_type_alias != 'we_program_type_course' THEN 1
            ELSE 0
        END AS is_parent_program
    FROM editions_base eb
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
            pe_p.global_code AS parent_code,
            pvs.sort_order AS sort_order
        FROM public.edition_structure es
        JOIN public.program_editions pe_p ON pe_p.edition_num_id = es.parent_edition_id
        LEFT JOIN public.program_version_structure pvs 
            ON pvs.child_program_version_id = eb.program_version_id
            AND pvs.parent_program_version_id = pe_p.program_version_id
        WHERE es.child_edition_id = eb.edition_num_id
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
            END = eb.start_date THEN 0 ELSE 1 END) ASC,
            pe_p.start_date ASC 
        LIMIT 1
    ) parent_sort ON true
),

-- Cálculos de distancia (excluyendo A5)
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

    -- Aplicación de filtros
    filtered AS (
        SELECT e.* FROM editions_calc e
        WHERE 
            (v_date_from IS NULL OR (e.start_date_eff BETWEEN v_date_from AND v_date_to))
            AND (v_instructor_ids IS NULL OR 
                e.instructor_id = ANY(v_instructor_ids) OR 
                (e.child_instructor_ids IS NOT NULL AND e.child_instructor_ids && v_instructor_ids)
            )
            AND (v_clasification_arr IS NULL OR 
                -- Caso 1: Igualdad simple (aquí Postgres suele ser flexible, pero mejor prevenir)
                e.clasification = ANY(v_clasification_arr) OR
                
                -- Caso 2: CAMBIO AQUÍ -> Agregamos ::text[] a la columna de la base de datos
                (e.program_type_alias = 'we_program_type_course' 
                 AND e.parent_clasifications::text[] && v_clasification_arr)
            )
            AND (v_program_version_id IS NULL OR e.program_version_id = v_program_version_id)
            AND (v_type_program_ids IS NULL OR e.cat_type_program_id = ANY(v_type_program_ids))
            AND (v_category_ids IS NULL OR e.cat_category_id = ANY(v_category_ids))
            AND (v_day_combination_ids IS NULL OR e.cat_day_combination_id = ANY(v_day_combination_ids))
            AND (v_segment_ids IS NULL OR e.cat_segment_id_eff = ANY(v_segment_ids))
            AND (v_hour_combination_ids IS NULL OR e.cat_hour_combination_id = ANY(v_hour_combination_ids))
            AND (v_course_category_ids IS NULL OR e.cat_course_category_id = ANY(v_course_category_ids))
            AND (v_model_modality_ids IS NULL OR e.cat_model_modality_id = ANY(v_model_modality_ids))
    ),
-- =========================================================
    -- NUEVO: Grafo de aristas bidireccionales (una sola vez)
    -- =========================================================
    all_edges AS (
        SELECT parent_edition_id AS a, child_edition_id AS b 
        FROM public.edition_structure
        UNION ALL
        SELECT child_edition_id, parent_edition_id 
        FROM public.edition_structure
    ),

    -- =========================================================
    -- NUEVO: Expansión recursiva desde TODAS las ediciones 
    -- filtradas simultáneamente (1 sola recursión total)
    -- =========================================================
    family_expansion AS (
        -- Semilla: cada edición filtrada es su propio root
        SELECT edition_num_id AS root_id, edition_num_id AS node_id
        FROM filtered

        UNION  -- UNION (no ALL) para evitar ciclos infinitos

        -- Expandir: subir padres y bajar hijos
        SELECT fe.root_id, ae.b AS node_id
        FROM family_expansion fe
        JOIN all_edges ae ON ae.a = fe.node_id
    ),

    -- =========================================================
    -- NUEVO: Agregar solo clasifications de PADRES por root
    -- =========================================================
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
    )
    -- Selección final
    SELECT
        f.edition_num_id,
        f.global_code,
        f.specific_code,
        f.program_abreviature,
        f.program_line_business,
        f.program_line_business_alias,
        f.cat_course_category_alias,
        f.version_code,
        f.program_type,
        f.program_type_alias,
        f.program_sessions,
        f.instructor,
        f.program_version_id,
        f.instructor_id,
        f.clasification,
        f.cat_segment,
        COALESCE(f.calc_da, 0) AS calc_da,
        COALESCE(f.calc_dp, 0) AS calc_dp,
        (f.expedient = 'Y') AS expedient,
        (f.preconfirmation = 'Y') AS preconfirmation,
        (f.confirmation = 'Y') AS confirmation,
        (f.upgrade = 'Y') AS upgrade,
        (f.new_methodology = 'Y') AS new_methodology,
        (f.active = 'Y') AS active,
        f.start_date_eff AS start_date,
        f.end_date_eff AS end_date,
        f.cat_type_approved,
        f.cat_status_edition,
        f.vacant,
        f.cat_course_category_label,
        f.user_registration_id,
        f.user_modification_id,
        f.registration_date,
        f.modification_date,
        f.notes,
        f.schedules,

        ffa.family_filter_value,
        -- Tree detail (estructura jerárquica)
        CASE
            WHEN f.program_type_alias = 'we_program_type_course' THEN
                COALESCE(
                    (SELECT jsonb_agg(
                        jsonb_build_object(
                            'parent_edition_id',      p.edition_num_id,
                            'parent_global_code',     p.global_code,
                            'parent_clasification',   p.clasification,
							'active', p.active,
                            'parent_abbreviation',    pv_parent.abbreviation,
                            'children', 
                            COALESCE(
                                (SELECT jsonb_agg(
                                    jsonb_build_object(
                                        'edition_num_id',  ch.edition_num_id,
                                        'global_code',     ch.global_code,
                                        'specific_code',   ch.specific_code,
                                        'active',          ch.active,
                                        'clasification',   ch.clasification,
                                        'abbreviation',    pv_child.abbreviation,
                                        'start_date',      ch.start_date,
                                        'end_date',        ch.end_date,
                                        'instructor', INITCAP(CONCAT(perch.first_name, ' ', perch.last_name)),
                                        'schedules',
                                        CASE
                                            WHEN ch.cat_day_combination_id IS NULL AND ch.cat_hour_combination_id IS NULL
                                            THEN '[]'::jsonb
                                            ELSE jsonb_build_array(
                                                jsonb_build_object(
                                                    'cat_day_combination_id',    ch.cat_day_combination_id,
                                                    'day_combination_label',     dayc2.description,
                                                    'cat_hour_combination_id',   ch.cat_hour_combination_id,
                                                    'hour_combination_label',    hourc2.description
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
            ELSE 
                COALESCE(
                    (SELECT jsonb_agg(
                        jsonb_build_object(
                            'edition_num_id',      ch.edition_num_id,
                            'global_code',         ch.global_code,
                            'specific_code',       ch.specific_code,
                            'active',              ch.active,
                            'clasification',       ch.clasification,
                            'program_version_id',  pv_child.program_version_id,
                            'abbreviation',        pv_child.abbreviation,
                            'start_date',          ch.start_date,
                            'end_date',            ch.end_date,
							'instructor', INITCAP(CONCAT(perch.first_name, ' ', perch.last_name)),
                            'schedules',
                            CASE
                                WHEN ch.cat_day_combination_id IS NULL AND ch.cat_hour_combination_id IS NULL
                                THEN '[]'::jsonb
                                ELSE jsonb_build_array(
                                    jsonb_build_object(
                                        'cat_day_combination_id',    ch.cat_day_combination_id,
                                        'day_combination_label',     dayc2.description,
                                        'cat_hour_combination_id',   ch.cat_hour_combination_id,
                                        'hour_combination_label',    hourc2.description
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
        END AS tree_detail

    FROM filtered f
    LEFT JOIN family_filter_agg ffa ON ffa.edition_num_id = f.edition_num_id 
    ORDER BY
    -- 1. FECHA DE INICIO (primario)
    f.start_date_eff ASC,
    
    -- 2. JERARQUÍA INTERNA DETECTADA
    f.has_internal_parent ASC,
    
    -- 3a. SI has_internal_parent = 0 (sin padre interno) → Aplicar JERARQUÍA EXTERNA
    CASE 
        WHEN f.has_internal_parent = 0 THEN
            CASE 
                WHEN f.parent_count = 0 THEN 0  -- Huérfano total (primero)
                WHEN f.parent_count > 0 THEN 1  -- Tiene padre externo (después)
                ELSE 999
            END
        ELSE 999  -- No aplica este criterio
    END ASC,
    
    -- 3b. SI has_internal_parent = 1 → PRIMERO: Agrupar por familia
    CASE 
        WHEN f.has_internal_parent = 1 THEN 
            COALESCE(f.child_by_date_group_detected, 'ZZZZZZZZZ')
        ELSE 'ZZZZZZZZZ'
    END ASC,
    
    -- 3c. Dentro de cada familia: Padre arriba, hijo(s) abajo
    CASE 
        WHEN f.has_internal_parent = 1 THEN
            CASE 
                WHEN f.is_parent_program = 1 THEN 0
                WHEN f.parent_count = 1 THEN 1
                WHEN f.parent_count > 1 THEN 2
                ELSE 999
            END
        ELSE 999
    END ASC,
    
    -- 3d. Prioridad por tipo de programa
    CASE 
        WHEN f.program_type_alias = 'we_program_type_diploma' THEN 1
        WHEN f.program_type_alias = 'we_program_type_pee' THEN 2
        WHEN f.program_type_alias = 'we_program_type_specialization' THEN 3
        ELSE 4
    END ASC,

    -- 4. Orden interno de hijos
    COALESCE(f.sort_child_order, 999) ASC,
    
    -- 5. Desempate final
    f.global_code ASC;

END;
$procedure$;
