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
$procedure$
