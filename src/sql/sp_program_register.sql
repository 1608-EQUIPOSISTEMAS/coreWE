CREATE OR REPLACE PROCEDURE public.sp_program_register(IN p_program jsonb, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
  v_id        int;
  v_active    bpchar(1);
  v_versions  jsonb;
  v_elem      jsonb;
  v_new_ver_id int;
  v_children  jsonb;
  v_child_id  int;
  v_child_order int; 
BEGIN
  IF p_cur IS NULL THEN
    p_cur := 'cur_sp_program_register';
  END IF;

  -- normalizar active ('Y' por defecto)
  v_active := COALESCE(NULLIF(p_program->>'active','')::bpchar, 'Y');

  IF v_active NOT IN ('Y','N') THEN
    RAISE EXCEPTION 'Valor de active inválido: % (solo Y o N)', v_active
      USING ERRCODE = '22000';
  END IF;

  -- INSERT en programs
  INSERT INTO public.programs (
    program_name,
    cat_type_program,
    active,
    user_registration_id,
    registration_date,
    cat_category,
    cat_business_line_id,
    cat_model_modality,
	skem_clasification,
	link
  )
  VALUES (
    NULLIF(p_program->>'program_name',''),
    NULLIF(p_program->>'cat_type_program','')::int,
    v_active,
    NULLIF(p_program->>'user_registration_id','')::int,
    NOW(),
    NULLIF(p_program->>'cat_category','')::int,
    NULLIF(p_program->>'cat_business_line_id','')::int,
    NULLIF(p_program->>'cat_model_modality','')::int,
    NULLIF(p_program->>'skem_clasification',''),
	NULLIF(p_program->>'link','')::varchar
  )
  RETURNING program_id INTO v_id;

  -- versiones (opcional)
  v_versions := p_program->'program_versions';

  IF v_versions IS NOT NULL AND jsonb_typeof(v_versions) = 'array' THEN
    FOR v_elem IN
      SELECT elem
      FROM jsonb_array_elements(v_versions) AS t(elem)
    LOOP
      -- Insertar versión
      INSERT INTO public.program_versions(
        program_id,
        version_code,
        sessions,
        active,
        user_registration_id,
		brand_name,
        registration_date,
        observations,
        description,
		cat_course_category,
        abbreviation,
		expedient_link
      )
      VALUES (
        v_id,
        NULLIF(v_elem->>'version_code',''),
        NULLIF(v_elem->>'sessions','')::int,
        COALESCE(NULLIF(v_elem->>'active','')::bpchar, 'Y'),
        NULLIF(p_program->>'user_registration_id','')::int,
        v_elem->>'brand_name',
        NOW(),
        v_elem->>'observations',
        v_elem->>'description',
        (v_elem->>'cat_course_category')::int,
        v_elem->>'abbreviation',
        v_elem->>'expedient_link'
      )
      RETURNING program_version_id INTO v_new_ver_id;

      -- Estructura (hijos) para esta versión recién creada
      v_children := v_elem->'children_ids';

      IF v_children IS NOT NULL
         AND jsonb_typeof(v_children) = 'array'
      THEN
        -- WITH ORDINALITY da (value, ord) donde ord = 1,2,3,...
        FOR v_child_id, v_child_order IN
          SELECT value::int, ord::int
          FROM jsonb_array_elements_text(v_children) WITH ORDINALITY AS t(value, ord)
        LOOP
          IF v_child_id IS NULL THEN
            CONTINUE;
          END IF;

          INSERT INTO public.program_version_structure(
            parent_program_version_id,
            child_program_version_id,
            sort_order             -- 👈 nueva columna
          )
          VALUES (v_new_ver_id, v_child_id, v_child_order)
          ON CONFLICT DO NOTHING;
        END LOOP;
      END IF;

    END LOOP;
  END IF;

  -- salida: program + versions + estructura hijos
  OPEN p_cur FOR
    SELECT
      p.program_id,
      (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'program_version_id',  pv.program_version_id,
                   'program_id',          pv.program_id,
                   'version_code',        pv.version_code,
                   'sessions',            pv.sessions,
                   'active',              pv.active,
                   'observations',        pv.observations,
                   'description',         pv.description,
                   'abbreviation',        pv.abbreviation,
                   'user_registration_id',pv.user_registration_id,
                   'user_modification_id',pv.user_modification_id,
                   'registration_date',   pv.registration_date,
                   'modification_date',   pv.modification_date,
                   'children_ids',
                     COALESCE(
                       (
                         SELECT jsonb_agg(pvs.child_program_version_id
                                          ORDER BY pvs.child_program_version_id)
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
                                    'abbreviation',             pv_child.abbreviation
                                  )
                                  ORDER BY pv_child.program_version_id
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
        WHERE pv.program_id = p.program_id
      ) AS program_versions
    FROM public.programs p
    WHERE p.program_id = v_id;
END;
$procedure$

