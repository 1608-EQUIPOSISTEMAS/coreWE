CREATE OR REPLACE PROCEDURE public.sp_program_update(IN p_program_id integer, IN p_program jsonb, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
DECLARE 
    v_active bpchar(1);
    v_versions jsonb;
    v_elem jsonb;
    v_ver_id int;
    v_user_mod int;
    v_children jsonb;
    v_child_id int;
    v_child_order int;
    v_new_active_version_id int; -- Para controlar cuál versión debe quedar activa
BEGIN 
    IF p_cur IS NULL THEN 
        p_cur := 'cur_sp_program_update';
    END IF;
    
    v_active := NULLIF(p_program->>'active','')::bpchar;
    
    IF v_active IS NOT NULL AND v_active NOT IN ('Y','N') THEN 
        RAISE EXCEPTION 'Valor de active inválido: % (solo Y o N)', v_active 
        USING ERRCODE = '22000';
    END IF;
    
    v_user_mod := NULLIF(p_program->>'user_modification_id','')::int;
    
    -- 1. UPDATE del padre (programs)
    UPDATE public.programs p SET 
        program_name = COALESCE(NULLIF(p_program->>'program_name',''), p.program_name),
        cat_type_program = COALESCE(NULLIF(p_program->>'cat_type_program','')::int, p.cat_type_program),
        cat_category = COALESCE(NULLIF(p_program->>'cat_category','')::int, p.cat_category),
        cat_business_line_id = COALESCE(NULLIF(p_program->>'cat_business_line_id','')::int, p.cat_business_line_id),
        cat_model_modality = COALESCE(NULLIF(p_program->>'cat_model_modality','')::int, p.cat_model_modality),
        active = COALESCE(v_active, p.active),
        user_modification_id = COALESCE(v_user_mod, p.user_modification_id),
        modification_date = NOW(),
        link = COALESCE(NULLIF(p_program->>'link',''), p.link),
        skem_clasification = COALESCE(NULLIF(p_program->>'skem_clasification',''), p.skem_clasification)
    WHERE p.program_id = p_program_id;
    
    -- 2. Procesamiento de versiones
    v_versions := p_program->'program_versions';
    
    IF v_versions IS NOT NULL AND jsonb_typeof(v_versions) = 'array' THEN
        
        -- **NUEVA LÓGICA: Identificar cuál versión debe quedar activa**
        -- Buscamos si hay alguna versión en el JSON con active='Y'
        SELECT NULLIF(elem->>'program_version_id','')::int INTO v_new_active_version_id
        FROM jsonb_array_elements(v_versions) AS elem
        WHERE NULLIF(elem->>'active','') = 'Y'
        LIMIT 1;
        
        -- Si encontramos una versión que debe estar activa, 
        -- desactivamos TODAS las demás versiones de este programa primero
        IF v_new_active_version_id IS NOT NULL THEN
            UPDATE public.program_versions
            SET active = 'N',
                user_modification_id = v_user_mod,
                modification_date = NOW()
            WHERE program_id = p_program_id 
              AND program_version_id != v_new_active_version_id
              AND active = 'Y';
        END IF;
        
        -- Ahora procesamos cada versión del JSON
        FOR v_elem IN SELECT elem FROM jsonb_array_elements(v_versions) AS t(elem) LOOP
            v_ver_id := NULLIF(v_elem->>'program_version_id','')::int;
            
            IF v_ver_id IS NOT NULL THEN 
                ----------------------------------------------------- 
                -- A) CASO UPDATE: Si viene ID, actualizamos
                ----------------------------------------------------- 
                UPDATE public.program_versions pv SET 
                    version_code = COALESCE(NULLIF(v_elem->>'version_code',''), pv.version_code),
                    sessions = COALESCE(NULLIF(v_elem->>'sessions','')::int, pv.sessions),
                    observations = COALESCE(v_elem->>'observations', pv.observations),
                    description = COALESCE(v_elem->>'description', pv.description),
                    expedient_link = COALESCE(v_elem->>'expedient_link', pv.expedient_link),
                    abbreviation = COALESCE(v_elem->>'abbreviation', pv.abbreviation),
                    user_modification_id = COALESCE(v_user_mod, pv.user_modification_id),
                    modification_date = NOW(),
                    brand_name = COALESCE(v_elem->>'brand_name', pv.brand_name),
                    active = COALESCE(NULLIF(v_elem->>'active',''), pv.active),
                    cat_course_category = COALESCE((v_elem->>'cat_course_category')::int, pv.cat_course_category)
                WHERE pv.program_version_id = v_ver_id 
                  AND pv.program_id = p_program_id;
                  
            ELSE 
                ----------------------------------------------------- 
                -- B) CASO INSERT: Si NO viene ID, creamos
                ----------------------------------------------------- 
                -- Si este nuevo registro debe estar activo, desactivamos otros primero
                IF NULLIF(v_elem->>'active','') = 'Y' THEN
                    UPDATE public.program_versions
                    SET active = 'N',
                        user_modification_id = v_user_mod,
                        modification_date = NOW()
                    WHERE program_id = p_program_id 
                      AND active = 'Y';
                END IF;
                
                INSERT INTO public.program_versions (
                    program_id,
                    version_code,
                    sessions,
                    observations,
                    description,
                    abbreviation,
                    expedient_link,
                    cat_course_category,
                    active,
                    user_registration_id,
                    registration_date,
                    user_modification_id,
                    modification_date,
                    brand_name
                ) VALUES (
                    p_program_id,
                    NULLIF(v_elem->>'version_code',''),
                    NULLIF(v_elem->>'sessions','')::int,
                    v_elem->>'observations',
                    v_elem->>'description',
                    v_elem->>'abbreviation',
                    v_elem->>'expedient_link',
                    (v_elem->>'cat_course_category')::int,
                    COALESCE(NULLIF(v_elem->>'active',''), 'Y'),
                    v_user_mod,
                    NOW(),
                    v_user_mod,
                    NOW(),
                    v_elem->>'brand_name'
                ) RETURNING program_version_id INTO v_ver_id;
                
            END IF;
            
            -- 3. Estructura de hijos
            v_children := v_elem->'children_ids';
            
            IF v_children IS NOT NULL AND jsonb_typeof(v_children) = 'array' THEN
                DELETE FROM public.program_version_structure 
                WHERE parent_program_version_id = v_ver_id;
                
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
                        sort_order
                    ) VALUES (v_ver_id, v_child_id, v_child_order)
                    ON CONFLICT DO NOTHING;
                END LOOP;
            END IF;
            
        END LOOP;
    END IF;
    
    -- 4. Salida: program + versions + hijos
    OPEN p_cur FOR
    SELECT 
        p.program_id,
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'program_version_id', pv.program_version_id,
                    'program_id', pv.program_id,
                    'version_code', pv.version_code,
                    'sessions', pv.sessions,
                    'active', pv.active,
                    'observations', pv.observations,
                    'description', pv.description,
                    'abbreviation', pv.abbreviation,
                    'user_registration_id', pv.user_registration_id,
                    'user_modification_id', pv.user_modification_id,
                    'registration_date', pv.registration_date,
                    'modification_date', pv.modification_date,
                    'children_ids', COALESCE(
                        (
                            SELECT jsonb_agg(pvs.child_program_version_id ORDER BY pvs.sort_order)
                            FROM public.program_version_structure pvs
                            WHERE pvs.parent_program_version_id = pv.program_version_id
                        ),
                        '[]'::jsonb
                    ),
                    'children_detail', COALESCE(
                        (
                            SELECT jsonb_agg(
                                jsonb_build_object(
                                    'child_program_version_id', pv_child.program_version_id,
                                    'program_name', p_child.program_name,
                                    'version_code', pv_child.version_code,
                                    'abbreviation', pv_child.abbreviation,
                                    'sort_order', pvs2.sort_order
                                ) ORDER BY pvs2.sort_order
                            )
                            FROM public.program_version_structure pvs2
                            JOIN public.program_versions pv_child ON pv_child.program_version_id = pvs2.child_program_version_id
                            JOIN public.programs p_child ON p_child.program_id = pv_child.program_id
                            WHERE pvs2.parent_program_version_id = pv.program_version_id
                        ),
                        '[]'::jsonb
                    )
                ) ORDER BY pv.program_version_id
            )
            FROM public.program_versions pv
            WHERE pv.program_id = p.program_id
        ) AS program_versions
    FROM public.programs p
    WHERE p.program_id = p_program_id;
    
END;
$procedure$

