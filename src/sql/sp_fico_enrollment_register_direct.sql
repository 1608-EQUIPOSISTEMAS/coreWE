-- ARCHIVO CANONICO de public.sp_fico_enrollment_register_direct. UNICA fuente.
-- (Fusiona lo que antes vivian en archivos separados ..._membership_benefit.sql y
--  ..._package_children.sql, que se pisaban entre si al redeployar. NO recrear
--  esos archivos: cualquier cambio al proc va AQUI.)
--
-- Vias de "pago cero" (eximen el chequeo list_price > 0): is_scholarship, B2B
-- documental (cat_b2b_doctype), beneficio de membresia (is_membership_benefit:
-- WE BLACK/GOLD/... regalan el curso, precio 0 legitimo, no es beca) e hijo de
-- paquete (parent_enrollment_id: la venta vive en el padre, el hijo solo ocupa
-- el aula). Ademas persiste membership_program_id (tier normalizado, FK a programs).
CREATE OR REPLACE PROCEDURE public.sp_fico_enrollment_register_direct(IN p_user_id integer, IN p_payload jsonb, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
    j_insc                   jsonb;
    j_payment_files          jsonb;
    j_att_item               jsonb;

    c_payment_plan_cash      int;
    c_payment_plan_install   int;
    c_fico_status_checked    int;
    c_enroll_status_pending  int;
    c_settlement_pending     int;
    c_inst_status_paid       int;
    c_inst_status_pending    int;
    c_pay_type_initial       int;
    c_cat_way_email          int;
    c_cat_way_phone          int;
    c_channel_general        int;
    c_certificate_paid       int;

    v_person_id              int;
    v_customer_id            int;
    v_enrollment_id          int;
    v_installment_id         int;
    v_program_version_id     int;
    v_program_edition_id     int;
    v_program_modality_alias text;
    v_is_membership          boolean;

    v_email                  text;
    v_phone                  text;
    v_document               text;
    v_first_name             text;
    v_last_name              text;
    v_cat_type_document      int;
    v_seller_agent_id        int;
    v_cat_profile            int;
    v_client_profile_str     text;
    v_observations           text;
    v_is_scholarship         boolean;
    v_is_membership_benefit  boolean;
    v_membership_program_id  int;
    v_parent_enrollment_id   int;
    v_cat_b2b_doctype        int;
    v_is_zero_payment        boolean;

    v_list_price             numeric(10,2);
    v_total_amount           numeric(10,2);
    v_adelanto               numeric;
    v_cat_payment_way        int;
    v_cat_payment_way_alias  text;
    v_cat_currency           int;
    v_cat_method_pay         int;
    v_cat_channel_pay        int;
    v_cat_business_entity    int;
    v_bank_account_id        int;
    v_transaction_code       text;
    v_cat_insc_modality      int;
    v_payment_date           timestamp;
    v_agent_origin           varchar(20);

    v_plan                   jsonb;
    v_item                   jsonb;
    v_plan_sum               numeric(10,2);
    v_remainder              numeric(10,2);

    v_voucher_url            text;
BEGIN
    IF p_cur IS NULL THEN
        p_cur := 'cur_sp_fico_enrollment_register_direct';
    END IF;

    j_insc := COALESCE(p_payload -> 'inscription', p_payload);

    -- Catalogos
    SELECT catalog_id INTO c_enroll_status_pending  FROM public."catalog" WHERE alias = 'we_inscription_way_act'         LIMIT 1;
    SELECT catalog_id INTO c_fico_status_checked    FROM public."catalog" WHERE alias = 'we_enrollment_status_checked'   LIMIT 1;
    SELECT catalog_id INTO c_inst_status_paid       FROM public."catalog" WHERE alias = 'we_payment_status_paid'         LIMIT 1;
    SELECT catalog_id INTO c_inst_status_pending    FROM public."catalog" WHERE alias = 'we_payment_status_pending'      LIMIT 1;
    SELECT catalog_id INTO c_pay_type_initial       FROM public."catalog" WHERE alias = 'we_payment_type_initial'        LIMIT 1;
    SELECT catalog_id INTO c_payment_plan_cash      FROM public."catalog" WHERE alias = 'we_payment_way_single'          LIMIT 1;
    SELECT catalog_id INTO c_payment_plan_install   FROM public."catalog" WHERE alias = 'we_payment_way_installments'    LIMIT 1;
    SELECT catalog_id INTO c_cat_way_email          FROM public."catalog" WHERE alias = 'we_way_contact_email'           LIMIT 1;
    SELECT catalog_id INTO c_cat_way_phone          FROM public."catalog" WHERE alias = 'we_way_contact_phone'           LIMIT 1;
    SELECT catalog_id INTO c_channel_general        FROM public."catalog" WHERE alias = 'we_channel_general'             LIMIT 1;
    SELECT catalog_id INTO c_certificate_paid       FROM public."catalog" WHERE alias = 'we_certificate_status_paid'     LIMIT 1;
    SELECT catalog_id INTO c_settlement_pending     FROM public."catalog" WHERE alias = 'we_settlement_status_pending'   LIMIT 1;

    -- Lectura de payload
    v_email                 := NULLIF(TRIM(j_insc->>'email'), '');
    v_phone                 := NULLIF(TRIM(j_insc->>'phone'), '');
    v_document              := NULLIF(TRIM(j_insc->>'document_number'), '');
    v_first_name            := NULLIF(TRIM(j_insc->>'first_name'), '');
    v_last_name             := NULLIF(TRIM(j_insc->>'last_name'), '');
    v_cat_type_document     := NULLIF(j_insc->>'cat_type_document', '')::int;
    v_program_version_id    := NULLIF(j_insc->>'program_version_id', '')::int;
    v_program_edition_id    := NULLIF(j_insc->>'program_edition_id', '')::int;
    v_seller_agent_id       := NULLIF(j_insc->>'seller_agent_id', '')::int;
    v_client_profile_str    := LOWER(COALESCE(j_insc->>'client_profile', ''));
    v_observations          := COALESCE(j_insc->>'observations', 'Registro directo FICO');
    v_is_scholarship        := COALESCE((j_insc->>'is_scholarship')::boolean, false);
    v_is_membership_benefit := COALESCE((j_insc->>'is_membership_benefit')::boolean, false);
    v_membership_program_id := NULLIF(j_insc->>'membership_program_id', '')::int;
    v_parent_enrollment_id  := NULLIF(j_insc->>'parent_enrollment_id', '')::int;
    v_cat_b2b_doctype       := NULLIF(j_insc->>'cat_b2b_doctype', '')::int;
    -- Hijo de paquete (tiene padre) = pago cero: la venta vive en el padre.
    v_is_zero_payment       := v_is_scholarship OR (v_cat_b2b_doctype IS NOT NULL) OR v_is_membership_benefit OR (v_parent_enrollment_id IS NOT NULL);
    v_cat_insc_modality     := NULLIF(j_insc->>'cat_insc_modality', '')::int;
    v_list_price            := COALESCE(NULLIF(j_insc->>'list_price', '')::numeric, 0);
    v_total_amount          := COALESCE(NULLIF(j_insc->>'total_amount', '')::numeric, v_list_price);
    v_adelanto              := COALESCE(NULLIF(j_insc->>'saved_money', '')::numeric, 0);
    v_cat_payment_way       := NULLIF(j_insc->>'cat_payment_way', '')::int;
    v_cat_currency          := COALESCE(NULLIF(j_insc->>'cat_currency', '')::int, 1);
    v_cat_method_pay        := NULLIF(j_insc->>'cat_payment_medium', '')::int;
    v_cat_channel_pay       := COALESCE(NULLIF(j_insc->>'cat_payment_channel', '')::int, c_channel_general);
    v_cat_business_entity   := NULLIF(j_insc->>'cat_business_entity', '')::int;
    v_bank_account_id       := NULLIF(j_insc->>'bank_account_id', '')::int;
    v_transaction_code      := NULLIF(j_insc->>'transaction_code', '');
    v_payment_date          := COALESCE(NULLIF(j_insc->>'payment_date', '')::timestamp, NOW());
    v_agent_origin          := NULLIF(UPPER(TRIM(j_insc->>'agent_origin')), '');

    -- Validaciones minimas (documento opcional para B2B/WEB; email siempre obligatorio como identificador)
    IF v_first_name IS NULL OR v_last_name IS NULL THEN
        OPEN p_cur FOR SELECT 2 AS result, 'Nombres y apellidos son obligatorios.' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;
    IF v_email IS NULL THEN
        OPEN p_cur FOR SELECT 2 AS result, 'El correo es obligatorio.' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;
    IF v_program_version_id IS NULL THEN
        OPEN p_cur FOR SELECT 2 AS result, 'El programa es obligatorio.' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;
    IF v_cat_insc_modality IS NULL THEN
        OPEN p_cur FOR SELECT 2 AS result, 'La modalidad de inscripcion es obligatoria.' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;
    IF NOT v_is_zero_payment AND v_list_price <= 0 THEN
        OPEN p_cur FOR SELECT 2 AS result, 'El precio base debe ser mayor a cero (excepto becas, B2B documental o beneficio de membresia).' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;

    -- Modalidad del programa + flag de membresia (membresias permiten cuotas aunque sean Online)
    SELECT c.alias, p.is_membership
      INTO v_program_modality_alias, v_is_membership
    FROM public.program_versions pv
    JOIN public.programs p ON p.program_id = pv.program_id
    JOIN public."catalog" c ON c.catalog_id = p.cat_model_modality
    WHERE pv.program_version_id = v_program_version_id
    LIMIT 1;

    IF v_program_modality_alias = 'we_modality_online' THEN
        IF v_program_edition_id IS NOT NULL THEN
            OPEN p_cur FOR SELECT 2 AS result, 'Los programas Online no requieren edicion.' AS message, NULL::int AS enrollment_id;
            RETURN;
        END IF;
        -- Cursos Online: solo contado. Membresias Online: cuotas permitidas (cobro recurrente).
        IF v_cat_payment_way = c_payment_plan_install AND NOT COALESCE(v_is_membership, false) THEN
            OPEN p_cur FOR SELECT 2 AS result, 'Los programas Online (no membresias) solo permiten pago al contado.' AS message, NULL::int AS enrollment_id;
            RETURN;
        END IF;
    END IF;

    -- Resolver perfil (obligatorio si hay edicion; constraint chk_profile_required_if_edition)
    IF v_client_profile_str = 'estudiante' THEN
        SELECT catalog_id INTO v_cat_profile FROM public."catalog" WHERE alias = 'we_profile_student' LIMIT 1;
    ELSIF v_client_profile_str = 'profesional' THEN
        SELECT catalog_id INTO v_cat_profile FROM public."catalog" WHERE alias = 'we_profile_professional' LIMIT 1;
    END IF;

    IF v_program_edition_id IS NOT NULL AND v_cat_profile IS NULL THEN
        OPEN p_cur FOR SELECT 2 AS result, 'El perfil (estudiante/profesional) es obligatorio para programas con edicion.' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;

    -- 1. Persona y customer: lookup SOLO por documento.
    -- Sin documento = nueva persona siempre (evita fusionar identidades distintas que comparten email).
    IF v_document IS NOT NULL THEN
        SELECT person_id INTO v_person_id
        FROM public.persons
        WHERE document_number = v_document AND active = 'Y'
        LIMIT 1;
    END IF;

    IF v_person_id IS NULL THEN
        INSERT INTO public.persons (
            first_name, last_name, document_number, cat_type_document,
            active, registration_date, user_registration_id
        )
        VALUES (
            v_first_name, v_last_name, v_document, v_cat_type_document,
            'Y', NOW(), p_user_id
        )
        RETURNING person_id INTO v_person_id;
    ELSE
        UPDATE public.persons
        SET first_name           = COALESCE(v_first_name, first_name),
            last_name            = COALESCE(v_last_name, last_name),
            document_number      = COALESCE(document_number, v_document),
            cat_type_document    = COALESCE(cat_type_document, v_cat_type_document),
            modification_date    = NOW(),
            user_modification_id = p_user_id
        WHERE person_id = v_person_id;
    END IF;

    SELECT customer_id INTO v_customer_id
    FROM public.customers
    WHERE person_id = v_person_id
    LIMIT 1;

    IF v_customer_id IS NULL THEN
        INSERT INTO public.customers (person_id, active, user_registration_id)
        VALUES (v_person_id, 'Y', p_user_id)
        RETURNING customer_id INTO v_customer_id;
    END IF;

    -- Contactos (idempotente: solo inserta si no existe)
    IF NOT EXISTS (
        SELECT 1 FROM public.person_contacts
        WHERE person_id = v_person_id AND cat_way_contact = c_cat_way_email AND value = v_email
    ) THEN
        INSERT INTO public.person_contacts (person_id, cat_way_contact, value, active, registration_date, user_registration_id)
        VALUES (v_person_id, c_cat_way_email, v_email, 'Y', NOW(), p_user_id);
    END IF;

    IF v_phone IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.person_contacts
        WHERE person_id = v_person_id AND cat_way_contact = c_cat_way_phone AND value = v_phone
    ) THEN
        INSERT INTO public.person_contacts (person_id, cat_way_contact, value, active, registration_date, user_registration_id)
        VALUES (v_person_id, c_cat_way_phone, v_phone, 'Y', NOW(), p_user_id);
    END IF;

    -- 2. Enrollment
    INSERT INTO public.enrollments (
        customer_id, program_version_id, program_edition_id, seller_agent_id,
        list_price, total_amount, discount_amount,
        cat_payment_plan, cat_currency, cat_payment_channel,
        cat_type_status, cat_fico_status, cat_certificate_status, cat_inscription_modality,
        registration_date, user_registration_id, active, cat_profile_id, notes,
        cat_b2b_doctype, agent_origin, membership_program_id, parent_enrollment_id
    )
    VALUES (
        v_customer_id, v_program_version_id, v_program_edition_id, v_seller_agent_id,
        v_list_price,
        CASE WHEN v_is_zero_payment THEN 0 ELSE v_total_amount END,
        CASE WHEN v_is_zero_payment THEN v_list_price ELSE 0 END,
        COALESCE(v_cat_payment_way, c_payment_plan_cash),
        v_cat_currency,
        v_cat_channel_pay,
        c_enroll_status_pending,
        c_fico_status_checked,
        c_certificate_paid,
        v_cat_insc_modality,
        NOW(), p_user_id, 'Y', v_cat_profile, v_observations,
        v_cat_b2b_doctype, v_agent_origin, v_membership_program_id, v_parent_enrollment_id
    )
    RETURNING enrollment_id INTO v_enrollment_id;

    -- 3. Comprobantes
    j_payment_files := COALESCE(j_insc -> 'ticket_payment_urls', '[]'::jsonb);
    v_voucher_url := NULL;
    IF jsonb_array_length(j_payment_files) > 0 THEN
        FOR j_att_item IN SELECT * FROM jsonb_array_elements(j_payment_files)
        LOOP
            INSERT INTO public.enrollment_attachments (
                enrollment_id, file_url, file_name, file_type,
                active, registration_date, user_registration_id
            )
            VALUES (
                v_enrollment_id,
                COALESCE(j_att_item->>'url', j_att_item#>>'{}'),
                j_att_item->>'name',
                j_att_item->>'type',
                'Y', NOW(), p_user_id
            );
            IF v_voucher_url IS NULL THEN
                v_voucher_url := COALESCE(j_att_item->>'url', j_att_item#>>'{}');
            END IF;
        END LOOP;
    END IF;

    -- 4. Cuotas y pagos
    SELECT alias INTO v_cat_payment_way_alias FROM public."catalog" WHERE catalog_id = v_cat_payment_way LIMIT 1;

    IF v_is_zero_payment THEN
        INSERT INTO public.payment_installments
            (enrollment_id, installment_number, amount, due_date, cat_status, notes)
        VALUES
            (v_enrollment_id, 1, 0, NOW()::date, c_inst_status_paid,
             CASE
                 WHEN v_cat_b2b_doctype IS NOT NULL THEN 'B2B documental - sin pago directo en FICO'
                 WHEN v_is_membership_benefit THEN 'Beneficio de membresia - curso de cortesia'
                 ELSE 'Beca - sin pago requerido'
             END)
        RETURNING installment_id INTO v_installment_id;

    ELSIF v_cat_payment_way_alias = 'we_payment_way_installments' AND v_adelanto > 0 THEN
        INSERT INTO public.payment_installments
            (enrollment_id, installment_number, amount, due_date, cat_status, notes)
        VALUES
            (v_enrollment_id, 0, v_adelanto, NOW()::date, c_inst_status_paid, 'Reserva / Pago inicial - Pago verificado, pendiente liquidacion bancaria')
        RETURNING installment_id INTO v_installment_id;

        IF v_cat_method_pay IS NOT NULL THEN
            INSERT INTO public.payments
                (enrollment_id, installment_id, amount, payment_date, transaction_code,
                 cat_method_payment, cat_payment_type, cat_settlement_status,
                 settled_in_account_id, evidence_url, active, user_registration_id, registration_date)
            VALUES
                (v_enrollment_id, v_installment_id, v_adelanto, v_payment_date, v_transaction_code,
                 v_cat_method_pay, c_pay_type_initial, c_settlement_pending,
                 v_bank_account_id, v_voucher_url, 'Y', p_user_id, NOW());
        END IF;

        v_plan := j_insc -> 'installment_plan';
        v_remainder := ROUND(v_total_amount - v_adelanto, 2);
        v_plan_sum := 0;
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_plan) LOOP
            v_plan_sum := v_plan_sum + ROUND((v_item->>'amount')::numeric, 2);
        END LOOP;

        IF ABS(v_plan_sum - v_remainder) > 0.01 THEN
            OPEN p_cur FOR SELECT 2 AS result,
                'La suma del plan de cuotas (' || v_plan_sum || ') no coincide con el saldo a financiar (' || v_remainder || ').' AS message,
                NULL::int AS enrollment_id;
            RETURN;
        END IF;

        FOR v_item IN SELECT * FROM jsonb_array_elements(v_plan) LOOP
            INSERT INTO public.payment_installments
                (enrollment_id, installment_number, amount, due_date, cat_status, notes)
            VALUES (
                v_enrollment_id,
                (v_item->>'installment_number')::int,
                ROUND((v_item->>'amount')::numeric, 2),
                (v_item->>'due_date')::date,
                c_inst_status_pending,
                'Cuota ' || (v_item->>'installment_number') || ' - Pendiente'
            );
        END LOOP;

    ELSE
        INSERT INTO public.payment_installments
            (enrollment_id, installment_number, amount, due_date, cat_status, notes)
        VALUES
            (v_enrollment_id, 1, v_total_amount, NOW()::date, c_inst_status_paid, 'Pago al contado - Verificado, pendiente liquidacion bancaria')
        RETURNING installment_id INTO v_installment_id;

        IF v_cat_method_pay IS NOT NULL THEN
            INSERT INTO public.payments
                (enrollment_id, installment_id, amount, payment_date, transaction_code,
                 cat_method_payment, cat_payment_type, cat_settlement_status,
                 settled_in_account_id, evidence_url, active, user_registration_id, registration_date)
            VALUES
                (v_enrollment_id, v_installment_id, v_total_amount, v_payment_date, v_transaction_code,
                 v_cat_method_pay, c_pay_type_initial, c_settlement_pending,
                 v_bank_account_id, v_voucher_url, 'Y', p_user_id, NOW());
        END IF;
    END IF;

    OPEN p_cur FOR
        SELECT 1 AS result, 'Inscripcion FICO registrada correctamente.' AS message, v_enrollment_id AS enrollment_id;

EXCEPTION
    WHEN OTHERS THEN
        OPEN p_cur FOR
            SELECT 0 AS result, SQLERRM AS message, NULL::int AS enrollment_id;
END;
$procedure$

