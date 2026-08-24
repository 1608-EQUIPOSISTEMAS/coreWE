-- Guarda la empresa del convenio en leads.company_id.
-- Generado por scripts/parche-lead-company-id.mjs desde el fuente vivo de
-- produccion. Idempotente: CREATE OR REPLACE de los 3 procedures.

CREATE OR REPLACE PROCEDURE public.sp_comercial_lead_register(IN p_person jsonb, IN p_lead jsonb, IN p_contact_attempts jsonb, IN p_user_registration_id integer, INOUT p_cur refcursor)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
  v_lead_id           int;
  v_attempt           jsonb;
  v_version_modality  int;
  v_version_type      int;
v_origen_manual     int;
BEGIN
  IF p_cur IS NULL THEN
    p_cur := 'cur_sp_comercial_lead_register';
  END IF;
SELECT catalog_id INTO v_origen_manual FROM public.catalog WHERE alias = 'we_origin_manual' LIMIT 1;
  -- =============================================
  -- VALIDACIONES PREVIAS (resultado '2')
  -- No se toca ninguna tabla, solo se valida y se sale
  -- =============================================

  -- Validación 1: Usuario con restricciones no puede registrar leads manualmente
  IF EXISTS (
    SELECT 1
    FROM public.user_lead_restrictions
    WHERE user_id = p_user_registration_id
      AND (
          cardinality(type_program_ids)    > 0 OR
          cardinality(model_modality_ids)  > 0 OR
          cardinality(program_ids)         > 0 OR
          cardinality(status_lead_ids)     > 0 OR
          cardinality(last_follow_ids)     > 0 OR
          cardinality(interest_level_ids)  > 0 OR
          cardinality(channel_ids)         > 0 OR
          cardinality(strategy_ids)        > 0 OR
          cardinality(moment_ids)          > 0
      )
  ) THEN
    OPEN p_cur FOR
      SELECT
        2          AS result,
        'El usuario ' || p_user_registration_id || ' tiene restricciones configuradas y no puede registrar leads manualmente.' AS message,
        NULL::int  AS lead_id;
    RETURN;
  END IF;

  -- Validación 2: Si se indica program_version_id, debe existir en la BD
  IF NULLIF(p_lead->>'program_version_id', '') IS NOT NULL THEN
    SELECT p.cat_model_modality, p.cat_type_program
    INTO v_version_modality, v_version_type
    FROM public.program_versions pv
    JOIN public.programs p ON p.program_id = pv.program_id
    WHERE pv.program_version_id = (p_lead->>'program_version_id')::int;

    IF NOT FOUND THEN
      OPEN p_cur FOR
        SELECT
          2          AS result,
          'La versión de programa indicada no existe.' AS message,
          NULL::int  AS lead_id;
      RETURN;
    END IF;
  END IF;

	-- =============================================
	-- VALIDACIONES CANAL / MEDIO
	-- =============================================
	
	-- Regla 1: Si canal es COTI (3172) o CHATBOT (3173), medio DEBE ser WEB (2590)
	IF NULLIF(p_lead->>'cat_channel','')::int IN (3172, 3173) THEN
	    IF NULLIF(p_lead->>'cat_medium_contact','')::int IS DISTINCT FROM 2590 THEN
	        OPEN p_cur FOR
	            SELECT
	                2          AS result,
	                'Cuando el canal es COTI o CHATBOT, el medio de llegada debe ser WEB obligatoriamente.' AS message,
	                NULL::int  AS lead_id;
	        RETURN;
	    END IF;
	END IF;
	
	-- Regla 2: Si canal es Instagram (2577), LinkedIn (2579) o Facebook (2576), medio NO puede ser WEB (2590)
	IF NULLIF(p_lead->>'cat_channel','')::int IN (2577, 2579, 2576) THEN
	    IF NULLIF(p_lead->>'cat_medium_contact','')::int = 2590 THEN
	        OPEN p_cur FOR
	            SELECT
	                2          AS result,
	                'Cuando el canal es Instagram, LinkedIn o Facebook, el medio de llegada no puede ser WEB.' AS message,
	                NULL::int  AS lead_id;
	        RETURN;
	    END IF;
	END IF;
	
	-- Regla 3: Si canal está vacío, medio también debe estar vacío
	IF NULLIF(p_lead->>'cat_channel','')::int IS NULL
	   AND NULLIF(p_lead->>'cat_medium_contact','')::int IS NOT NULL THEN
	    OPEN p_cur FOR
	        SELECT
	            2          AS result,
	            'Si el canal de prospección está vacío, el medio de llegada también debe estarlo.' AS message,
	            NULL::int  AS lead_id;
	    RETURN;
	END IF;




	-- Si el status es "Pagó", no puede venir ningún attempt pendiente en el array
IF NULLIF(p_lead->>'cat_status_lead','')::int = (
    SELECT catalog_id FROM public."catalog" WHERE alias = 'we_lead_status_bought' LIMIT 1
) THEN
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_contact_attempts) AS att
        WHERE NULLIF(att->>'cat_result','')::int = 3169 -- we_calling_pending
    ) THEN
        OPEN p_cur FOR
            SELECT
                2          AS result,
                'No se puede registrar el lead en estado "Pagó" con intentos de contacto en estado Pendiente.' AS message,
                NULL::int  AS lead_id;
        RETURN;
    END IF;
END IF;

  -- =============================================
  -- BLOQUE TRANSACCIONAL
  -- =============================================

  -- 1) Insertar el lead
  INSERT INTO public.leads (
    program_edition_id,
    cat_channel,
    cat_medium_contact,
    cat_frecuency_word,
    active,
    bot,
    web,
    b2b,
    user_registration_id,
    registration_date,
  first_contact_date,
    cat_type_strategy,
    cat_prospect_situation,
    cat_status_lead,
    cat_interest_level,
    message_init_conversation,
    observations,
    cat_program_type,
    cat_program_modality,
    program_version_id,
    origin_phone,
origin_seller_phone,
    origin_email,
    cat_code_country,
    source_campaign_id,
    source_event_id,
    agreed_amount,
    full_name,
    pay_date,
    cat_query,
    cat_client_moment,
    membership_moment_id,
    cat_type_client,
    company_id
  )
  VALUES (
    NULLIF(p_lead->>'program_edition_id','')::int,
    NULLIF(p_lead->>'cat_channel','')::int,
    NULLIF(p_lead->>'cat_medium_contact','')::int,
    NULLIF(p_lead->>'cat_frecuency_word','')::int,
    'Y',
    NULLIF(p_lead->>'bot','')::char,
    NULLIF(p_lead->>'web','')::char,
    NULLIF(p_lead->>'b2b','')::char,
    p_user_registration_id,
    NOW(),
  NULLIF(p_lead->>'first_contact_date','')::timestamp,  
    NULLIF(p_lead->>'cat_type_strategy','')::int,
    NULLIF(p_lead->>'cat_prospect_situation','')::int,
    NULLIF(p_lead->>'cat_status_lead','')::int,
    NULLIF(p_lead->>'cat_interest_level','')::int,
    NULLIF(p_lead->>'message_init_conversation',''),
    NULLIF(p_lead->>'observations',''),
    COALESCE(v_version_type,     NULLIF(p_lead->>'cat_program_type','')::int),
    COALESCE(v_version_modality, NULLIF(p_lead->>'cat_program_modality','')::int),
    NULLIF(p_lead->>'program_version_id','')::int,
    NULLIF(p_lead->>'origin_phone',''),
NULLIF(p_lead->>'origin_seller_phone',''), 
    NULLIF(p_lead->>'origin_email',''),
    NULLIF(p_lead->>'cat_code_country','')::int,
    NULLIF(p_lead->>'source_campaign_id','')::int,
    NULLIF(p_lead->>'source_event_id','')::int,
    NULLIF(p_lead->>'agreed_amount','')::numeric,
    NULLIF(p_lead->>'full_name',''),
    NULLIF(p_lead->>'pay_date','')::date,
    NULLIF(p_lead->>'cat_query','')::int,
    public.fn_client_moment(
      NULLIF(p_lead->>'origin_phone',''),
      NULLIF(p_lead->>'cat_client_moment','')::int
    ),
    NULLIF(p_lead->>'membership_moment_id','')::int,
    NULLIF(p_lead->>'cat_client_type','')::int,
    NULLIF(p_lead->>'company_id','')::int
  )
  RETURNING lead_id INTO v_lead_id;

  -- 2) Intentos de contacto
  IF p_contact_attempts IS NOT NULL
     AND jsonb_typeof(p_contact_attempts) = 'array'
     AND jsonb_array_length(p_contact_attempts) > 0
  THEN
    FOR v_attempt IN
      SELECT * FROM jsonb_array_elements(p_contact_attempts)
    LOOP
      INSERT INTO public.lead_contact_attempts (
        lead_id,
        attempt_number,
        contact_datetime,
        cat_result,
        cat_type_attempt,cat_creation_origin,
        response,
        user_id,
        contact_duration,
        registration_date
      )
      VALUES (
        v_lead_id,
        NULLIF(v_attempt->>'attempt_number','')::int,
        NULLIF(v_attempt->>'contact_datetime','')::timestamp,
        NULLIF(v_attempt->>'cat_result','')::int,
        NULLIF(v_attempt->>'cat_type_attempt','')::int,v_origen_manual,
        NULLIF(v_attempt->>'response',''),
        p_user_registration_id,
        COALESCE(NULLIF(v_attempt->>'contact_duration','')::int, 0),
        NOW()
      );
    END LOOP;
  END IF;

  -- =============================================
  -- SALIDA EXITOSA
  -- =============================================
  OPEN p_cur FOR
    SELECT
      1         AS result,
      'Lead registrado correctamente' AS message,
      v_lead_id AS lead_id;

EXCEPTION
  WHEN OTHERS THEN
    -- ROLLBACK AUTOMÁTICO — error inesperado
    OPEN p_cur FOR
      SELECT
        0          AS result,
        SQLERRM    AS message,
        NULL::int  AS lead_id;
END;
$procedure$
;

CREATE OR REPLACE PROCEDURE public.sp_comercial_lead_update(IN p_lead_id integer, IN p_lead jsonb, IN p_user_modification_id integer, IN p_contact_attempts jsonb, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
    v_contact_attempt       jsonb;
    v_next_attempt_number   int;
    v_version_modality      int;
    v_version_type          int;
    v_attempt_id            int;
    v_check_enrollment_id   int;
    v_origen_manual         int;
    v_id_attempt_call       int; -- Variable para ID dinámico de llamada
    v_status_observed       int; -- [SUBSANAR] estado Observado
    v_check_fico_status     int; -- [SUBSANAR] estado FICO de la inscripción del lead
BEGIN
    -- Inicialización del cursor
    IF p_cur IS NULL THEN
        p_cur := 'cur_sp_comercial_lead_update';
    END IF;

    -- Obtener IDs de catálogo necesarios
    SELECT catalog_id INTO v_origen_manual FROM public.catalog WHERE alias = 'we_origin_manual' LIMIT 1;
    SELECT catalog_id INTO v_id_attempt_call FROM public.catalog WHERE alias = 'we_attempt_call' LIMIT 1;

    -- =====================================================
    -- VALIDACIONES PREVIAS (Error controlado → result = 2)
    -- =====================================================

    -- 1. Verificar que el lead exista
    IF NOT EXISTS (SELECT 1 FROM leads WHERE lead_id = p_lead_id) THEN
        OPEN p_cur FOR
            SELECT
                2         AS result,
                'El lead con ID ' || p_lead_id || ' no existe.' AS message,
                NULL::int AS lead_id;
        RETURN;
    END IF;

    -- 2. Verificar que no tenga matrícula activa.
    -- [SUBSANAR] Excepción: si la inscripción está OBSERVADA, comercial está en
    -- proceso de subsanación y SÍ puede editar el lead para corregir los datos
    -- antes de reenviar a FICO. Solo se bloquea cuando la matrícula NO está observada.
    SELECT enrollment_id INTO v_check_enrollment_id
    FROM leads
    WHERE lead_id = p_lead_id;

    IF v_check_enrollment_id IS NOT NULL THEN
        SELECT catalog_id INTO v_status_observed
        FROM public.catalog WHERE alias = 'we_enrollment_status_observed' LIMIT 1;

        SELECT cat_fico_status INTO v_check_fico_status
        FROM enrollments WHERE enrollment_id = v_check_enrollment_id;

        IF v_check_fico_status IS DISTINCT FROM v_status_observed THEN
            OPEN p_cur FOR
                SELECT
                    2         AS result,
                    'No es posible modificar este lead porque ya cuenta con una matrícula activa (ID: ' || v_check_enrollment_id || '). Para realizar cambios, contacte al administrador o gestione desde el módulo de alumnos.' AS message,
                    NULL::int AS lead_id;
            RETURN;
        END IF;
    END IF;

    -- 3. Verificar que el program_version_id exista si fue enviado
    IF NULLIF(p_lead->>'program_version_id', '') IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
            FROM public.program_versions pv
            WHERE pv.program_version_id = (p_lead->>'program_version_id')::int
        ) THEN
            OPEN p_cur FOR
                SELECT
                    2         AS result,
                    'La versión de programa indicada no existe.' AS message,
                    NULL::int AS lead_id;
            RETURN;
        END IF;

        -- Obtener datos de la versión
        SELECT p.cat_model_modality, p.cat_type_program
        INTO v_version_modality, v_version_type
        FROM public.program_versions pv
        JOIN programs p ON p.program_id = pv.program_id
        WHERE pv.program_version_id = (p_lead->>'program_version_id')::int;
    END IF;

    -- =============================================
    -- VALIDACIONES CANAL / MEDIO
    -- =============================================
    
    -- Regla 1: Si canal es COTI o CHATBOT, medio DEBE ser WEB (2590)
    IF NULLIF(p_lead->>'cat_channel','')::int IN (3172, 3173) THEN
        IF NULLIF(p_lead->>'cat_medium_contact','')::int IS DISTINCT FROM 2590 THEN
            OPEN p_cur FOR SELECT 2 AS result, 'Cuando el canal es COTI o CHATBOT, el medio de llegada debe ser WEB obligatoriamente.' AS message, NULL::int AS lead_id;
            RETURN;
        END IF;
    END IF;
    
    -- Regla 2: Si canal es Instagram, LinkedIn o Facebook, medio NO puede ser WEB (2590)
    IF NULLIF(p_lead->>'cat_channel','')::int IN (2577, 2579, 2576) THEN
        IF NULLIF(p_lead->>'cat_medium_contact','')::int = 2590 THEN
            OPEN p_cur FOR SELECT 2 AS result, 'Cuando el canal es Instagram, LinkedIn o Facebook, el medio de llegada no puede ser WEB.' AS message, NULL::int AS lead_id;
            RETURN;
        END IF;
    END IF;
    
    -- Regla 3: Si canal está vacío, medio también debe estar vacío
    IF NULLIF(p_lead->>'cat_channel','')::int IS NULL AND NULLIF(p_lead->>'cat_medium_contact','')::int IS NOT NULL THEN
        OPEN p_cur FOR SELECT 2 AS result, 'Si el canal de prospección está vacío, el medio de llegada también debe estarlo.' AS message, NULL::int AS lead_id;
        RETURN;
    END IF;

    -- Validación Status "Pagó" (we_lead_status_bought)
    IF NULLIF(p_lead->>'cat_status_lead','')::int = (SELECT catalog_id FROM public."catalog" WHERE alias = 'we_lead_status_bought' LIMIT 1) THEN
        -- A. Attempts existentes en BD pendientes
        IF EXISTS (
            SELECT 1 FROM public.lead_contact_attempts lca
            WHERE lca.lead_id = p_lead_id AND lca.cat_result = 3169 -- we_calling_pending
            AND NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(p_contact_attempts) AS att
                WHERE NULLIF(att->>'id','')::int = lca.lead_contact_attempt_id
                AND NULLIF(att->>'cat_result','')::int != 3169
            )
        ) THEN
            OPEN p_cur FOR SELECT 2 AS result, 'No se puede cambiar el estado a "Pagó": existen intentos de contacto en estado Pendiente sin resolver.' AS message, NULL::int AS lead_id;
            RETURN;
        END IF;

        -- B. Nuevos attempts entrantes (sin id) con pending
        IF EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_contact_attempts) AS att
            WHERE NULLIF(att->>'id','') IS NULL AND NULLIF(att->>'cat_result','')::int = 3169
        ) THEN
            OPEN p_cur FOR SELECT 2 AS result, 'No se puede registrar un intento en estado Pendiente cuando el lead está en estado "Pagó".' AS message, NULL::int AS lead_id;
            RETURN;
        END IF;
    END IF;

    -- =====================================================
    -- BLOQUE TRANSACCIONAL
    -- =====================================================

    -- 1. Actualización de la tabla leads
    UPDATE leads l
    SET
        program_edition_id   = CASE WHEN p_lead ? 'program_edition_id' THEN NULLIF(p_lead->>'program_edition_id', '')::int ELSE l.program_edition_id END,
        program_version_id   = CASE WHEN p_lead ? 'program_version_id' THEN NULLIF(p_lead->>'program_version_id', '')::int ELSE l.program_version_id END,
        cat_program_type     = COALESCE(v_version_type, NULLIF(p_lead->>'cat_program_type','')::int, l.cat_program_type),
        cat_program_modality = COALESCE(v_version_modality, NULLIF(p_lead->>'cat_program_modality','')::int, l.cat_program_modality),
        cat_query            = CASE WHEN p_lead ? 'cat_query' THEN NULLIF(p_lead->>'cat_query', '')::int ELSE l.cat_query END,
        membership_moment_id = CASE WHEN p_lead ? 'membership_moment_id' THEN NULLIF(p_lead->>'membership_moment_id', '')::int ELSE l.membership_moment_id END,
        bot                  = COALESCE(p_lead->>'bot', l.bot),
        active               = COALESCE(p_lead->>'active', l.active),
        web                  = COALESCE(p_lead->>'web', l.web),
        b2b                  = COALESCE(p_lead->>'b2b', l.b2b),
        first_contact_date   = COALESCE(NULLIF(p_lead->>'first_contact_date', '')::timestamp, l.first_contact_date),
        cat_channel          = COALESCE(NULLIF(p_lead->>'cat_channel','')::int, l.cat_channel),
        cat_medium_contact   = COALESCE(NULLIF(p_lead->>'cat_medium_contact','')::int, l.cat_medium_contact),
        cat_frecuency_word   = COALESCE(NULLIF(p_lead->>'cat_frecuency_word','')::int, l.cat_frecuency_word),
        user_modification_id = p_user_modification_id,
        modification_date    = NOW(),
        cat_type_strategy    = CASE WHEN p_lead ? 'cat_type_strategy' THEN NULLIF(p_lead->>'cat_type_strategy', '')::int ELSE l.cat_type_strategy END,
        cat_prospect_situation = CASE WHEN p_lead ? 'cat_prospect_situation' THEN NULLIF(p_lead->>'cat_prospect_situation', '')::int ELSE l.cat_prospect_situation END,
        cat_status_lead      = COALESCE(NULLIF(p_lead->>'cat_status_lead','')::int, l.cat_status_lead),
        cat_interest_level   = COALESCE(NULLIF(p_lead->>'cat_interest_level','')::int, l.cat_interest_level),
        message_init_conversation = COALESCE(NULLIF(p_lead->>'message_init_conversation',''), l.message_init_conversation),
        observations         = CASE WHEN p_lead ? 'observations' THEN NULLIF(p_lead->>'observations', '') ELSE l.observations END,
        origin_phone         = COALESCE(NULLIF(p_lead->>'origin_phone',''), l.origin_phone),
origin_seller_phone = COALESCE(NULLIF(p_lead->>'origin_seller_phone',''), l.origin_seller_phone),
        origin_email         = CASE WHEN p_lead ? 'origin_email' THEN NULLIF(p_lead->>'origin_email', '') ELSE l.origin_email END,
        cat_code_country     = COALESCE(NULLIF(p_lead->>'cat_code_country','')::int, l.cat_code_country),
        source_campaign_id   = CASE WHEN p_lead ? 'source_campaign_id' THEN NULLIF(p_lead->>'source_campaign_id', '')::int ELSE l.source_campaign_id END,
        source_event_id      = CASE WHEN p_lead ? 'source_event_id' THEN NULLIF(p_lead->>'source_event_id', '')::int ELSE l.source_event_id END,
        agreed_amount        = CASE WHEN p_lead ? 'agreed_amount' THEN NULLIF(p_lead->>'agreed_amount', '')::numeric ELSE l.agreed_amount END,
        full_name            = COALESCE(NULLIF(p_lead->>'full_name',''), l.full_name),
        pay_date             = CASE WHEN p_lead ? 'pay_date' THEN NULLIF(p_lead->>'pay_date', '')::date ELSE l.pay_date END,
        cat_client_moment    = public.fn_client_moment(
                                 COALESCE(NULLIF(p_lead->>'origin_phone',''), l.origin_phone),
                                 CASE WHEN p_lead ? 'cat_client_moment'
                                      THEN NULLIF(p_lead->>'cat_client_moment', '')::int
                                      ELSE l.cat_client_moment END,
                                 l.registration_date),
        cat_type_client      = COALESCE(NULLIF(p_lead->>'cat_client_type','')::int, l.cat_type_client),
        company_id           = CASE WHEN p_lead ? 'company_id' THEN NULLIF(p_lead->>'company_id', '')::int ELSE l.company_id END
    WHERE l.lead_id = p_lead_id;

    -- 2. Gestión de intentos de contacto
    IF p_contact_attempts IS NOT NULL AND jsonb_typeof(p_contact_attempts) = 'array'
       AND jsonb_array_length(p_contact_attempts) > 0
    THEN
        -- PASADA 1: UPDATEs (Intentos existentes)
        FOR v_contact_attempt IN SELECT * FROM jsonb_array_elements(p_contact_attempts)
        LOOP
            v_attempt_id := NULLIF(v_contact_attempt->>'id', '')::int;
            CONTINUE WHEN v_attempt_id IS NULL;

            UPDATE public.lead_contact_attempts
            SET
                cat_result            = COALESCE(NULLIF(v_contact_attempt->>'cat_result','')::int,             cat_result),
                cat_type_attempt      = COALESCE(NULLIF(v_contact_attempt->>'cat_type_attempt','')::int,       cat_type_attempt),
                contact_datetime      = COALESCE(NULLIF(v_contact_attempt->>'contact_datetime','')::timestamp, contact_datetime),
                response              = COALESCE(NULLIF(v_contact_attempt->>'response',''),                    response),
                contact_duration      = COALESCE(NULLIF(v_contact_attempt->>'contact_duration','')::int,       contact_duration),
                cat_reschedule_origin = CASE 
                                            WHEN v_contact_attempt ? 'cat_reschedule_origin' 
                                            THEN NULLIF(v_contact_attempt->>'cat_reschedule_origin', '')::int 
                                            ELSE cat_reschedule_origin 
                                        END,
                user_modification_id  = p_user_modification_id,
                modification_date     = NOW()
            WHERE lead_contact_attempt_id = v_attempt_id
              AND lead_id = p_lead_id
              AND (
                  -- 1. Es el último intento (regla por defecto)
                  attempt_number = (SELECT MAX(attempt_number) FROM public.lead_contact_attempts WHERE lead_id = p_lead_id)
                  
                  -- 2. O es una llamada pendiente que se está CERRANDO (REGLA RESTAURADA)
                  OR (cat_result = 3169 AND NULLIF(v_contact_attempt->>'cat_result', '')::int != 3169)
                  
                  -- 3. O NO es una llamada (REGLA NUEVA: WhatsApp, Correo, etc. siempre editables)
                  OR (cat_type_attempt IS DISTINCT FROM v_id_attempt_call)
              );
        END LOOP;

        -- PASADA 2: INSERTs (Intentos nuevos)
        FOR v_contact_attempt IN SELECT * FROM jsonb_array_elements(p_contact_attempts)
        LOOP
            v_attempt_id := NULLIF(v_contact_attempt->>'id', '')::int;
            CONTINUE WHEN v_attempt_id IS NOT NULL;

            SELECT COALESCE(MAX(attempt_number), 0) + 1 INTO v_next_attempt_number
            FROM public.lead_contact_attempts WHERE lead_id = p_lead_id;

            INSERT INTO public.lead_contact_attempts (
                lead_id, attempt_number, cat_result, cat_type_attempt, cat_creation_origin,
                contact_datetime, response, contact_duration, user_id, registration_date,
                cat_reschedule_origin
            )
            VALUES (
                p_lead_id, v_next_attempt_number,
                NULLIF(v_contact_attempt->>'cat_result','')::int,
                NULLIF(v_contact_attempt->>'cat_type_attempt','')::int, v_origen_manual,
                COALESCE(NULLIF(v_contact_attempt->>'contact_datetime','')::timestamp, NOW()),
                NULLIF(v_contact_attempt->>'response',''),
                COALESCE(NULLIF(v_contact_attempt->>'contact_duration','')::int, 0),
                p_user_modification_id, NOW(),
                NULLIF(v_contact_attempt->>'cat_reschedule_origin','')::int
            );
        END LOOP;
    END IF;

    -- =====================================================
    -- SALIDA EXITOSA (result = 1)
    -- =====================================================
    OPEN p_cur FOR
        SELECT
            1           AS result,
            'Lead actualizado correctamente.' AS message,
            p_lead_id   AS lead_id;

EXCEPTION
    WHEN OTHERS THEN
    -- =====================================================
    -- ERROR INESPERADO → ROLLBACK AUTOMÁTICO (result = 0)
    -- =====================================================
        OPEN p_cur FOR
            SELECT
                0         AS result,
                SQLERRM   AS message,
                NULL::int AS lead_id;
END;
$procedure$
;

CREATE OR REPLACE PROCEDURE public.sp_comercial_lead_get(IN p_lead_id integer, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
BEGIN
  IF p_cur IS NULL THEN
    p_cur := 'cur_sp_comercial_lead_get';
  END IF;

  OPEN p_cur FOR
  SELECT
    /* ====== básicos ====== */
l.registration_date,           -- se mantiene solo para auditoría interna
l.first_contact_date,          -- ← NUEVO, el que se muestra al usuario
to_char(l.first_contact_date, 'DD/MM/YYYY HH24:MI') AS registration_date_fmt,
to_char(l.modification_date,  'DD/MM/YYYY HH24:MI') AS modification_date_fmt,
    l.origin_phone,l.origin_seller_phone, l.origin_email, l.full_name, l.pay_date,
    l.program_version_id, l.program_edition_id,
    
    /* info de versión / programa */
    pv.program_version_id AS pv_id, p.program_id, p.link as program_link,
    pv.abbreviation AS program_label, pe.edition_num_id,
    TO_CHAR(pe.start_date, 'DD/MM/YYYY') AS edition_label,

    /* ====== PRECIOS ====== */
    COALESCE(pp.price_student_soles, 0.00)       AS price_student_soles,
    COALESCE(pp.price_student_dollars, 0.00)     AS price_student_dollars,
    COALESCE(pp.price_profesional_soles, 0.00)   AS price_profesional_soles,
    COALESCE(pp.price_profesional_dollars, 0.00) AS price_profesional_dollars,

    /* ====== catálogos ====== */
    cs.alias  AS status_alias,             cs.description  AS status_label,
    cc.alias  AS country_alias,            cc.description  AS country_label,
    cq.alias  AS query_alias,              cq.description  AS query_label,
    ci.alias  AS interest_alias,           ci.description  AS interest_label,
    ch.alias  AS channel_alias,            ch.description  AS channel_label,
    cm.alias  AS medium_alias,             cm.description  AS medium_label,
    cw.alias  AS key_word_alias,           cw.description  AS key_word_label,
    ts.alias  AS strategy_alias,           ts.description  AS strategy_label,
    ps.alias  AS ocupacion_alias,          ps.description  AS ocupacion_label,
    ctp.alias AS category_alias,           ctp.description AS category_label,
    cmm.alias AS program_modality_alias,   cmm.description AS program_modality_label,
    psp.alias AS client_status,            psp.description AS client_status_label,

    l.message_init_conversation, l.observations, l.active, l.bot, l.web, l.b2b,
    l.company_id,
    (SELECT co.razon_social FROM public.companies co WHERE co.company_id = l.company_id) AS company_name,
    cx.alias AS cat_client_moment_alias,  cx.description AS cat_client_moment_label,
    mt.tier_name AS membership_tier_label, l.membership_moment_id,

    /* ====== intentos de contacto como JSON ====== */
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
			    'lead_contact_attempt_id', a.lead_contact_attempt_id,
			    'cat_result_label',        coax.description,
			    'cat_result_alias',        coax.alias,
			    'cat_result_id',           a.cat_result,
			    'cat_type_attempt_label',        coaxa.description,
			    'cat_type_attempt_alias',        coaxa.alias,
			    'cat_type_attempt_id',           a.cat_type_attempt,
			    'contact_duration',        a.contact_duration,
			    'response',                a.response,
			    'contact_datetime',        a.contact_datetime,
			    'attempt_number',          a.attempt_number,
			    'cat_creation_origin',     c_org.alias,
			    -- ✅ AGREGADOS
			    'registration_date',       a.registration_date,
			    'modification_date',       a.modification_date,
			    'user_id',                 a.user_id,
			    'user_registration_label', u_att_reg.name,
			    'user_modification_id',    a.user_modification_id,
			    'user_modification_label', u_att_mod.name
			) ORDER BY a.attempt_number ASC
        )
        FROM lead_contact_attempts a
        LEFT JOIN catalog coax ON coax.catalog_id = a.cat_result
        LEFT JOIN catalog coaxa ON coaxa.catalog_id = a.cat_type_attempt
        LEFT JOIN catalog c_org ON c_org.catalog_id = a.cat_creation_origin -- 🔴 NUEVO JOIN INTERNO
LEFT JOIN users u_att_reg    ON u_att_reg.user_id = a.user_id              -- ✅ AGREGADO
LEFT JOIN users u_att_mod    ON u_att_mod.user_id = a.user_modification_id 
        WHERE a.lead_id = p_lead_id
      ),
      '[]'::jsonb
    ) AS contact_attempts,

    l.enrollment_id,
    cqa.alias AS cat_program_type_alias,
    cqx.alias AS cat_program_modality_alias,
	l.user_registration_id,
	ureg.name AS user_registration_label,
	l.user_modification_id,
	umod.name AS user_modification_label

  FROM leads l
  LEFT JOIN catalog cs   ON cs.catalog_id  = l.cat_status_lead
  LEFT JOIN catalog cc   ON cc.catalog_id  = l.cat_code_country
  LEFT JOIN catalog cq   ON cq.catalog_id  = l.cat_query
  LEFT JOIN catalog cqa  ON cqa.catalog_id = l.cat_program_type
  LEFT JOIN catalog cqx  ON cqx.catalog_id = l.cat_program_modality
  LEFT JOIN catalog ci   ON ci.catalog_id  = l.cat_interest_level
  LEFT JOIN catalog ch   ON ch.catalog_id  = l.cat_channel
  LEFT JOIN catalog cm   ON cm.catalog_id  = l.cat_medium_contact
  LEFT JOIN catalog cw   ON cw.catalog_id  = l.cat_frecuency_word
  LEFT JOIN catalog ts   ON ts.catalog_id  = l.cat_type_strategy
  LEFT JOIN catalog ps   ON ps.catalog_id  = l.cat_prospect_situation
  LEFT JOIN catalog psp  ON psp.catalog_id = l.cat_type_client
  LEFT JOIN catalog cx   ON cx.catalog_id  = l.cat_client_moment
  LEFT JOIN membership_tiers mt ON mt.membership_tier_id = l.membership_moment_id
  LEFT JOIN program_versions pv ON pv.program_version_id = l.program_version_id
  LEFT JOIN programs p          ON p.program_id          = pv.program_id
  LEFT JOIN program_editions pe ON pe.edition_num_id     = l.program_edition_id
  LEFT JOIN catalog ctp ON ctp.catalog_id = p.cat_type_program
  LEFT JOIN catalog cmm ON cmm.catalog_id = p.cat_model_modality
  LEFT JOIN users ureg  ON ureg.user_id   = l.user_registration_id
  LEFT JOIN users umod  ON umod.user_id   = l.user_modification_id
  LEFT JOIN (
      SELECT
          program_version_id,
          MAX(CASE WHEN cat_profile_id = 3087 AND cat_currency_id = 3041 THEN list_price END) AS price_student_soles,
          MAX(CASE WHEN cat_profile_id = 3087 AND cat_currency_id = 3042 THEN list_price END) AS price_student_dollars,
          MAX(CASE WHEN cat_profile_id = 3086 AND cat_currency_id = 3041 THEN list_price END) AS price_profesional_soles,
          MAX(CASE WHEN cat_profile_id = 3086 AND cat_currency_id = 3042 THEN list_price END) AS price_profesional_dollars
      FROM public.program_pricing
      WHERE active = true
      GROUP BY program_version_id
  ) pp ON pp.program_version_id = l.program_version_id
  WHERE l.lead_id = p_lead_id;

END;
$procedure$
;
