CREATE OR REPLACE PROCEDURE public.sp_comercial_enrollment_register(IN p_lead_id integer, IN p_user_id integer, IN p_payload jsonb, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
    j_insc                   jsonb;
    j_payment_files          jsonb;
    j_attachments            jsonb;
    j_att_item               jsonb;
    v_cat_certificate_status int;
    v_cat_insc_modality      int;

    c_payment_plan_cash      int;
    c_payment_plan_install   int;
    c_fico_status            int;
    c_enroll_status_pending  int;
    c_lead_status_insc       int;
    c_lead_status_bought     int;
    c_pay_settlement_pend    int;
    c_inst_status_paid       int;
    c_pay_type_initial       int;
    c_profile_general_id     int;
    c_cat_way_email          int;
    c_cat_way_phone          int;
    c_inst_pending           int;
    c_inst_draft             int;
    c_pay_status_pending     int;

    c_channel_general        int;
    c_channel_token          int;
    c_channel_web            int;

    c_b2b_service_order      int;
    c_b2b_purchase_order     int;
    v_cat_b2b_doctype        int;
    v_is_doc_pending         boolean;

    c_status_observed        int;          -- [RESUBMIT]
    c_inst_paid_legacy       int;          -- [RESUBMIT]
    v_existing_fico_status   int;          -- [RESUBMIT]
    v_is_resubmit            boolean := false;  -- [RESUBMIT]

    v_person_id              int;
    v_customer_id            int;
    v_enrollment_id          int;
    v_installment_id         int;
    v_program_version_id     int;
    v_program_edition_id     int;

    v_program_modality_alias text;
    v_program_type_alias     text;

    v_email                  text;
    v_phone                  text;

    v_lead_status_id         int;
    v_lead_pay_date          date;

    v_list_price             numeric(10,2);
    v_current_total          numeric(10,2);
    v_discount_val           numeric(10,2);
    v_applied_amt            numeric(10,2);
    v_total_discount         numeric(10,2) := 0;
    v_front_total            numeric(10,2);

    v_dsct_pct_id            int;
    v_dsct_stk_id            int;
    v_dsct_ben_id            int;

    v_adelanto               numeric;
    v_cat_payment_way        int;
    v_cat_payment_way_alias  text;
    v_cat_currency           int;
    v_cat_method_pay         int;
    v_cat_channel_pay        int;
    v_cat_token_prov         int;

    v_plan                   jsonb;
    v_item                   jsonb;
    v_plan_sum               numeric(10,2);
    v_remainder              numeric(10,2);

    v_cat_profile            int;

    v_agent_origin           varchar(20);
BEGIN
    IF p_cur IS NULL THEN
        p_cur := 'cur_sp_enrollment_register';
    END IF;

    j_insc := p_payload -> 'inscription';

    v_email                  := NULLIF(TRIM(j_insc->>'email'), '');
    v_cat_channel_pay        := NULLIF(j_insc->>'cat_payment_channel', '')::int;
    v_cat_token_prov         := NULLIF(j_insc->>'cat_token_provider',  '')::int;
    v_cat_method_pay         := NULLIF(j_insc->>'cat_method_payment',  '')::int;
    v_cat_certificate_status := NULLIF(j_insc->>'cat_certificate_status', '')::int;
    v_cat_insc_modality      := NULLIF(j_insc->>'cat_insc_modality', '')::int;

    IF v_cat_certificate_status IS NULL THEN
        OPEN p_cur FOR SELECT 2 AS result, 'El estado del certificado es obligatorio.' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;

    IF v_cat_insc_modality IS NULL THEN
        OPEN p_cur FOR SELECT 2 AS result, 'La modalidad de inscripción es obligatoria.' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;

    SELECT catalog_id INTO c_enroll_status_pending FROM public."catalog" WHERE alias = 'we_inscription_way_act'        LIMIT 1;
    SELECT catalog_id INTO c_fico_status           FROM public."catalog" WHERE alias = 'we_enrollment_status_pending'  LIMIT 1;
    SELECT catalog_id INTO c_lead_status_insc      FROM public."catalog" WHERE alias = 'we_lead_status_bought'         LIMIT 1;
    SELECT catalog_id INTO c_pay_settlement_pend   FROM public."catalog" WHERE alias = 'we_payment_status_pending'     LIMIT 1;
    SELECT catalog_id INTO c_inst_status_paid      FROM public."catalog" WHERE alias = 'we_payment_status_paid'        LIMIT 1;
    SELECT catalog_id INTO c_pay_type_initial      FROM public."catalog" WHERE alias = 'we_payment_type_initial'       LIMIT 1;
    SELECT catalog_id INTO c_lead_status_bought    FROM public."catalog" WHERE alias = 'we_lead_status_bought'         LIMIT 1;
    SELECT catalog_id INTO c_profile_general_id    FROM public."catalog" WHERE alias = 'we_profile_general'            LIMIT 1;
    SELECT catalog_id INTO c_payment_plan_cash     FROM public."catalog" WHERE alias = 'we_payment_way_single'         LIMIT 1;
    SELECT catalog_id INTO c_payment_plan_install  FROM public."catalog" WHERE alias = 'we_payment_way_installments'   LIMIT 1;
    SELECT catalog_id INTO c_cat_way_email         FROM public."catalog" WHERE alias = 'we_way_contact_email'          LIMIT 1;
    SELECT catalog_id INTO c_cat_way_phone         FROM public."catalog" WHERE alias = 'we_way_contact_phone'          LIMIT 1;
    SELECT catalog_id INTO c_channel_general       FROM public."catalog" WHERE alias = 'we_channel_general'            LIMIT 1;
    SELECT catalog_id INTO c_channel_token         FROM public."catalog" WHERE alias = 'we_channel_token'              LIMIT 1;
    SELECT catalog_id INTO c_channel_web           FROM public."catalog" WHERE alias = 'we_channel_web'                LIMIT 1;
    SELECT catalog_id INTO c_inst_pending          FROM public."catalog" WHERE alias = 'we_payment_status_pending'     LIMIT 1;
    SELECT catalog_id INTO c_inst_draft            FROM public."catalog" WHERE alias = 'we_payment_status_draft'       LIMIT 1;
    SELECT catalog_id INTO c_pay_status_pending    FROM public."catalog" WHERE alias = 'we_payment_status_pending'     LIMIT 1;
    SELECT catalog_id INTO c_status_observed       FROM public."catalog" WHERE alias = 'we_enrollment_status_observed' LIMIT 1;  -- [RESUBMIT]
    SELECT catalog_id INTO c_inst_paid_legacy      FROM public."catalog" WHERE alias = 'we_inst_paid'                  LIMIT 1;  -- [RESUBMIT]
    SELECT catalog_id INTO c_b2b_service_order     FROM public."catalog" WHERE alias = 'we_enrollment_b2b_doctype_service_order'  LIMIT 1;
    SELECT catalog_id INTO c_b2b_purchase_order    FROM public."catalog" WHERE alias = 'we_enrollment_b2b_doctype_purchase_order' LIMIT 1;

    -- Venta con Orden de Servicio / de Compra: el asesor sube la orden en lugar
    -- del voucher porque la empresa deposita semanas despues. La inscripcion
    -- nace con su monto real y la cuota PENDIENTE; el cobro llega mas tarde.
    -- COALESCE: si el alias no existiera, el IN daria NULL y no false.
    v_cat_b2b_doctype := NULLIF(j_insc->>'cat_b2b_doctype', '')::int;
    v_is_doc_pending  := COALESCE(v_cat_b2b_doctype IN (c_b2b_service_order, c_b2b_purchase_order), false);

    IF v_is_doc_pending AND v_cat_channel_pay <> c_channel_general THEN
        OPEN p_cur FOR SELECT 2 AS result, 'Una venta con OS/OP solo se registra por el canal General.' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;

    -- 1. Datos del Lead. El CASE detecta ambos aliases que activan B2B:
    --    legacy 'we_prospect_situation_corporate' + nuevo 'we_prospect_situation_convenios'.
    SELECT
        l.cat_status_lead,
        l.pay_date,
        c_prof.catalog_id,
        l.program_version_id,
        l.program_edition_id,
        NULLIF(TRIM(l.origin_phone), ''),
        CASE WHEN c_sit.alias IN ('we_prospect_situation_corporate', 'we_prospect_situation_convenios')
             THEN 'B2B'
             ELSE NULL
        END
    INTO
        v_lead_status_id,
        v_lead_pay_date,
        v_cat_profile,
        v_program_version_id,
        v_program_edition_id,
        v_phone,
        v_agent_origin
    FROM public.leads l
    LEFT JOIN public."catalog" c_sit  ON c_sit.catalog_id = l.cat_prospect_situation
    LEFT JOIN public."catalog" c_prof ON c_prof.alias      = c_sit.variable_2
    WHERE l.lead_id = p_lead_id;

    IF NOT FOUND THEN
        OPEN p_cur FOR SELECT 2 AS result, 'El Lead ID ' || p_lead_id || ' no existe.' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;

    IF v_cat_profile IS NULL THEN
        v_cat_profile := c_profile_general_id;
    END IF;

    IF v_program_version_id IS NULL THEN
        OPEN p_cur FOR SELECT 2 AS result, 'El Lead no tiene una versión de programa asignada.' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;

    SELECT c.alias INTO v_program_modality_alias
    FROM public.program_versions pv
    JOIN public.programs p ON p.program_id = pv.program_id
    JOIN public."catalog" c ON c.catalog_id = p.cat_model_modality
    WHERE pv.program_version_id = v_program_version_id
    LIMIT 1;

    SELECT c.alias INTO v_program_type_alias
    FROM public.program_versions pv
    JOIN public.programs p ON p.program_id = pv.program_id
    JOIN public."catalog" c ON c.catalog_id = p.cat_type_program
    WHERE pv.program_version_id = v_program_version_id
    LIMIT 1;

    IF v_lead_pay_date IS NULL THEN
        OPEN p_cur FOR SELECT 2 AS result, 'El Lead no tiene Fecha de Pago registrada. Por favor, regístrela antes de matricular.' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;

    IF v_lead_pay_date > CURRENT_DATE THEN
        OPEN p_cur FOR SELECT 2 AS result,
            'La Fecha de Pago (' || TO_CHAR(v_lead_pay_date, 'DD/MM/YYYY') || ') es futura. Solo se puede matricular cuando el pago ya se haya realizado (hoy o fecha pasada).' AS message,
            NULL::int AS enrollment_id;
        RETURN;
    END IF;

    -- [RESUBMIT] Guarda de duplicidad con excepción para subsanación.
    -- Antes: si el lead ya tenía enrollment_id se rechazaba siempre.
    -- Ahora: si esa inscripción está OBSERVADA y no tiene pagos confirmados,
    -- se permite reconstruirla en sitio (mismo enrollment_id).
    SELECT e.enrollment_id, e.cat_fico_status
      INTO v_enrollment_id, v_existing_fico_status
    FROM public.leads l
    JOIN public.enrollments e ON e.enrollment_id = l.enrollment_id
    WHERE l.lead_id = p_lead_id;

    IF v_enrollment_id IS NOT NULL THEN
        IF v_existing_fico_status IS DISTINCT FROM c_status_observed THEN
            OPEN p_cur FOR SELECT 2 AS result, 'El Lead ya cuenta con una matrícula registrada. No se puede matricular dos veces.' AS message, NULL::int AS enrollment_id;
            RETURN;
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.payment_installments
            WHERE enrollment_id = v_enrollment_id
              AND cat_status IN (c_inst_status_paid, c_inst_paid_legacy)
        ) OR EXISTS (
            SELECT 1 FROM public.payments
            WHERE enrollment_id = v_enrollment_id
              AND cat_settlement_status IN (c_inst_status_paid, c_inst_paid_legacy)
        ) THEN
            OPEN p_cur FOR SELECT 2 AS result, 'No se puede subsanar: la inscripción ya tiene pagos confirmados. Pide a FICO que corrija los datos desde el detalle de la inscripción.' AS message, NULL::int AS enrollment_id;
            RETURN;
        END IF;

        v_is_resubmit := true;
    END IF;

    IF v_program_modality_alias = 'we_modality_online'
   AND v_program_type_alias <> 'we_program_type_membership' THEN
        IF v_program_edition_id IS NOT NULL THEN
            OPEN p_cur FOR SELECT 2 AS result, 'Los programas Online no requieren edición. Retire la edición del lead antes de matricular.' AS message, NULL::int AS enrollment_id;
            RETURN;
        END IF;
        IF NULLIF(j_insc->>'cat_type_payment', '') IS NOT NULL THEN
            IF (j_insc->>'cat_type_payment')::int = c_payment_plan_install THEN
                OPEN p_cur FOR SELECT 2 AS result, 'Los programas Online solo permiten pago al contado. No se permite la modalidad en cuotas.' AS message, NULL::int AS enrollment_id;
                RETURN;
            END IF;
        END IF;
    END IF;

    IF (j_insc->>'observations') IS NULL THEN
        OPEN p_cur FOR SELECT 2 AS result, 'El campo observations es obligatorio.' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;

    IF v_email IS NULL THEN
        OPEN p_cur FOR SELECT 2 AS result, 'El campo email es obligatorio.' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;

    IF v_cat_channel_pay IS NULL THEN
        OPEN p_cur FOR SELECT 2 AS result, 'El campo canal de pago es obligatorio para procesar la matrícula.' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;

    IF v_cat_channel_pay = c_channel_general THEN
        IF NULLIF(j_insc->>'cat_type_payment', '') IS NULL THEN
            OPEN p_cur FOR SELECT 2 AS result, 'La Modalidad de Pago es obligatoria (contado o cuotas). Por favor seleccione una opción.' AS message, NULL::int AS enrollment_id;
            RETURN;
        END IF;

        IF v_cat_method_pay IS NULL THEN
            OPEN p_cur FOR SELECT 2 AS result, 'El canal General requiere indicar el Medio de Pago (efectivo, transferencia, yape, etc.).' AS message, NULL::int AS enrollment_id;
            RETURN;
        END IF;

        IF jsonb_array_length(COALESCE(j_insc->'ticket_payment_urls', '[]'::jsonb)) = 0
           AND COALESCE((j_insc->>'dsct_porcent_id'), '') = ''
        THEN
            OPEN p_cur FOR SELECT 2 AS result, 'El canal General requiere adjuntar al menos un Comprobante de Pago.' AS message, NULL::int AS enrollment_id;
            RETURN;
        END IF;

        IF NULLIF(j_insc->>'cat_type_payment', '') IS NOT NULL THEN
            SELECT alias INTO v_cat_payment_way_alias
            FROM public."catalog"
            WHERE catalog_id = (j_insc->>'cat_type_payment')::int
            LIMIT 1;

            IF v_cat_payment_way_alias = 'we_payment_way_installments' THEN
                -- Antes de exigirle un plan: una OS/OP no se financia, la empresa
                -- gira el total. Rechazar aca da el mensaje util; si no, el asesor
                -- recibe un reclamo por el adelanto que ni deberia estar llenando.
                IF v_is_doc_pending THEN
                    OPEN p_cur FOR SELECT 2 AS result, 'Una venta con OS/OP se registra al contado: la empresa paga el total cuando llega la orden.' AS message, NULL::int AS enrollment_id;
                    RETURN;
                END IF;
                IF COALESCE((j_insc->>'saved_money')::numeric, 0) <= 0 THEN
                    OPEN p_cur FOR SELECT 2 AS result, 'La modalidad en cuotas requiere un adelanto/reserva mayor a cero.' AS message, NULL::int AS enrollment_id;
                    RETURN;
                END IF;
                IF jsonb_array_length(COALESCE(j_insc->'installment_plan', '[]'::jsonb)) = 0 THEN
                    OPEN p_cur FOR SELECT 2 AS result, 'La modalidad en cuotas requiere un plan de cuotas con al menos una cuota.' AS message, NULL::int AS enrollment_id;
                    RETURN;
                END IF;
            END IF;
        END IF;
    ELSIF v_cat_channel_pay = c_channel_token THEN
        IF v_cat_token_prov IS NULL THEN
            OPEN p_cur FOR SELECT 2 AS result, 'Debe indicar el proveedor del link/token (Qulqi, MercadoPago, etc.).' AS message, NULL::int AS enrollment_id;
            RETURN;
        END IF;
    ELSIF v_cat_channel_pay = c_channel_web THEN
        NULL;
    ELSE
        OPEN p_cur FOR SELECT 2 AS result, 'Canal de pago no reconocido. Valores válidos: General, Link/Token, Pago Web.' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.lead_contact_attempts
        WHERE lead_id  = p_lead_id
          AND cat_result = 3169
    ) THEN
        OPEN p_cur FOR SELECT 2 AS result, 'El lead tiene intentos de contacto en estado Pendiente. Ciérrelos antes de matricular.' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;

    v_adelanto        := COALESCE((j_insc->>'saved_money')::numeric, 0);
    v_cat_payment_way := NULLIF(j_insc->>'cat_type_payment', '')::int;
    v_cat_currency    := COALESCE((j_insc->>'cat_currency')::int, 1);

    SELECT alias INTO v_cat_payment_way_alias
    FROM public."catalog"
    WHERE catalog_id = v_cat_payment_way
    LIMIT 1;

    v_list_price := NULLIF(j_insc->>'list_price', '')::numeric;

    IF v_list_price IS NULL OR v_list_price <= 0 THEN
        OPEN p_cur FOR SELECT 2 AS result, 'El Precio Base es obligatorio. No se recibió desde el formulario.' AS message, NULL::int AS enrollment_id;
        RETURN;
    END IF;

    v_current_total := v_list_price;

    SELECT person_id INTO v_person_id
    FROM public.persons
    WHERE document_number = (j_insc->>'document') AND active = 'Y'
    LIMIT 1;

    IF v_person_id IS NULL THEN
        INSERT INTO public.persons (
            first_name, last_name, mother_last_name,
            document_number, cat_type_document,
            active, registration_date, user_registration_id
        )
        VALUES (
            j_insc->>'full_name',
            j_insc->>'last_name',
            j_insc->>'mother_last_name',
            j_insc->>'document',
            (j_insc->>'cat_type_document')::int,
            'Y', NOW(), p_user_id
        )
        RETURNING person_id INTO v_person_id;
    ELSE
        UPDATE public.persons
        SET
            first_name           = COALESCE(NULLIF(TRIM(j_insc->>'full_name'),        ''), first_name),
            last_name            = COALESCE(NULLIF(TRIM(j_insc->>'last_name'),        ''), last_name),
            mother_last_name     = COALESCE(NULLIF(TRIM(j_insc->>'mother_last_name'), ''), mother_last_name),
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

    -- [RESUBMIT] En re-registro no duplicamos los contactos (email/teléfono):
    -- ya existen del alta original. En alta nueva sí se insertan.
    IF NOT v_is_resubmit THEN
        INSERT INTO public.person_contacts (
            person_id, cat_way_contact, value,
            active, registration_date, user_registration_id
        )
        VALUES (v_person_id, c_cat_way_email, v_email, 'Y', NOW(), p_user_id);

        IF v_phone IS NOT NULL THEN
            INSERT INTO public.person_contacts (
                person_id, cat_way_contact, value,
                active, registration_date, user_registration_id
            )
            VALUES (v_person_id, c_cat_way_phone, v_phone, 'Y', NOW(), p_user_id);
        END IF;
    END IF;

    v_dsct_pct_id := NULLIF(j_insc->>'dsct_porcent_id', '')::int;
    v_dsct_stk_id := NULLIF(j_insc->>'dsct_stick_id',   '')::int;

    -- [RESUBMIT] Alta nueva (INSERT) vs subsanación (limpiar + UPDATE en sitio).
    IF v_is_resubmit THEN
        -- Borrar artefactos financieros previos (todos pendientes; validado arriba).
        -- Orden por FK: payments -> payment_installments.
        DELETE FROM public.payments               WHERE enrollment_id = v_enrollment_id;
        DELETE FROM public.payment_installments   WHERE enrollment_id = v_enrollment_id;
        DELETE FROM public.enrollment_discounts   WHERE enrollment_id = v_enrollment_id;
        DELETE FROM public.enrollment_attachments WHERE enrollment_id = v_enrollment_id;

        -- Reconstruir cabecera conservando identidad y atribución original
        -- (seller_agent_id, registration_date, user_registration_id intactos).
        UPDATE public.enrollments SET
            customer_id              = v_customer_id,
            program_version_id       = v_program_version_id,
            program_edition_id       = v_program_edition_id,
            list_price               = v_list_price,
            total_amount             = v_list_price,
            discount_amount          = 0,
            cat_payment_plan         = CASE
                                          WHEN v_cat_channel_pay = c_channel_general THEN v_cat_payment_way
                                          ELSE c_payment_plan_cash
                                       END,
            cat_currency             = v_cat_currency,
            cat_payment_channel      = v_cat_channel_pay,
            cat_type_status          = c_enroll_status_pending,
            cat_fico_status          = c_fico_status,            -- sale de Observado -> Pendiente
            cat_certificate_status   = v_cat_certificate_status,
            cat_inscription_modality = v_cat_insc_modality,
            b2b_contract_id          = NULLIF(j_insc->>'b2b_contract_id', '')::int,
            cat_b2b_doctype          = v_cat_b2b_doctype,
            student_attachment_url   = j_insc->>'student_attachment_url',
            cat_profile_id           = v_cat_profile,
            agent_origin             = v_agent_origin,
            notes                    = NULLIF(j_insc->>'observations', ''),
            modification_date        = NOW(),
            user_modification_id     = p_user_id
        WHERE enrollment_id = v_enrollment_id;
    ELSE
        INSERT INTO public.enrollments (
            customer_id,
            program_version_id,
            program_edition_id,
            seller_agent_id,
            list_price,
            total_amount,
            discount_amount,
            cat_payment_plan,
            cat_currency,
            cat_payment_channel,
            cat_type_status,
            cat_fico_status,
            cat_certificate_status,
            cat_inscription_modality,
            registration_date,
            user_registration_id,
            b2b_contract_id,
            cat_b2b_doctype,
            student_attachment_url,
            active,
            cat_profile_id,
            agent_origin,
            notes
        )
        VALUES (
            v_customer_id,
            v_program_version_id,
            v_program_edition_id,
            p_user_id,
            v_list_price,
            v_list_price,
            0,
            CASE
                WHEN v_cat_channel_pay = c_channel_general THEN v_cat_payment_way
                ELSE c_payment_plan_cash
            END,
            v_cat_currency,
            v_cat_channel_pay,
            c_enroll_status_pending,
            c_fico_status,
            v_cat_certificate_status,
            v_cat_insc_modality,
            NOW(),
            p_user_id,
            NULLIF(j_insc->>'b2b_contract_id', '')::int,
            v_cat_b2b_doctype,
            j_insc->>'student_attachment_url',
            'Y',
            v_cat_profile,
            v_agent_origin,
            NULLIF(j_insc->>'observations', '')
        )
        RETURNING enrollment_id INTO v_enrollment_id;
    END IF;

    IF v_dsct_pct_id IS NOT NULL THEN
        SELECT value INTO v_discount_val FROM public.discounts WHERE discount_id = v_dsct_pct_id;
        v_applied_amt    := ROUND((v_current_total * (v_discount_val / 100.0)), 2);
        v_current_total  := v_current_total - v_applied_amt;
        v_total_discount := v_total_discount + v_applied_amt;
        INSERT INTO public.enrollment_discounts (enrollment_id, discount_id, order_applied, calculated_amount, user_registration_id)
        VALUES (v_enrollment_id, v_dsct_pct_id, 1, v_applied_amt, p_user_id);
    END IF;

    IF v_dsct_stk_id IS NOT NULL THEN
        SELECT value INTO v_discount_val FROM public.discounts WHERE discount_id = v_dsct_stk_id;
        v_applied_amt    := ROUND(v_current_total - v_discount_val, 2);
        v_current_total  := ROUND(v_discount_val, 2);
        v_total_discount := v_total_discount + v_applied_amt;

        IF v_applied_amt < 0 THEN
            OPEN p_cur FOR SELECT 2 AS result,
                'El precio de la promoción (' || v_discount_val || ') supera el precio base actual (' || (v_current_total + v_applied_amt) || ').' AS message,
                NULL::int AS enrollment_id;
            RETURN;
        END IF;

        INSERT INTO public.enrollment_discounts (enrollment_id, discount_id, order_applied, calculated_amount, user_registration_id)
        VALUES (v_enrollment_id, v_dsct_stk_id, 2, v_applied_amt, p_user_id);
    END IF;

    DECLARE
        v_ben_order int := 3;
        -- Beca: si el porcentaje o la promo ya dejaron el saldo en cero, los
        -- beneficios se registran en 0 — valen por su ETIQUETA (CUENTA PERSONAL,
        -- Traera laptop), que es lo que avisa a Sistemas y a Logistica, no por su
        -- monto. Se evalua ANTES del loop para que un beneficio no altere el
        -- trato del siguiente. Espejo exacto de beneficiosSoloBadge en
        -- Frontend/src/features/apply-discounts/computeDiscounts.js: si los dos
        -- lados no coinciden, el guard de discrepancia de mas abajo rechaza la venta.
        v_ben_solo_badge boolean := (v_current_total <= 0);
    BEGIN
        FOR v_item IN
            SELECT * FROM jsonb_array_elements(
                COALESCE(j_insc -> 'dsct_benefit_ids', '[]'::jsonb)
            )
        LOOP
            SELECT value INTO v_discount_val
            FROM public.discounts
            WHERE discount_id = (v_item->>'value')::int;

            IF v_discount_val IS NOT NULL THEN
                v_applied_amt    := CASE WHEN v_ben_solo_badge THEN 0 ELSE ROUND(v_discount_val, 2) END;
                v_current_total  := v_current_total - v_applied_amt;
                v_total_discount := v_total_discount + v_applied_amt;

                INSERT INTO public.enrollment_discounts (
                    enrollment_id, discount_id, order_applied, calculated_amount, user_registration_id
                )
                VALUES (
                    v_enrollment_id,
                    (v_item->>'value')::int,
                    v_ben_order,
                    v_applied_amt,
                    p_user_id
                );

                v_ben_order := v_ben_order + 1;
            END IF;
        END LOOP;
    END;

    v_current_total := TRUNC(v_current_total, 0);
    v_front_total   := COALESCE(NULLIF(j_insc->>'total_amount', '')::numeric, 0);

    IF ABS(v_current_total - v_front_total) > 0.01 THEN
        OPEN p_cur FOR SELECT 2 AS result,
            'Discrepancia de montos detectada. Calculado en sistema: ' || v_current_total || ', Enviado por formulario: ' || v_front_total || '. Por favor, refresque los descuentos e intente nuevamente.' AS message,
            NULL::int AS enrollment_id;
        RETURN;
    END IF;

    UPDATE public.enrollments
    SET total_amount    = v_current_total,
        discount_amount = v_total_discount
    WHERE enrollment_id = v_enrollment_id;

    j_payment_files := COALESCE(j_insc -> 'ticket_payment_urls', '[]'::jsonb);

    IF jsonb_array_length(j_payment_files) > 0 THEN
        FOR j_att_item IN SELECT * FROM jsonb_array_elements(j_payment_files)
        LOOP
            INSERT INTO public.enrollment_attachments (
                enrollment_id, file_url, file_name, file_type,
                active, registration_date, user_registration_id
            )
            VALUES (
                v_enrollment_id,
                j_att_item->>'url',
                j_att_item->>'name',
                j_att_item->>'type',
                'Y', NOW(), p_user_id
            );
        END LOOP;
    END IF;

    j_attachments := COALESCE(j_insc -> 'attachments', '[]'::jsonb);

    IF jsonb_array_length(j_attachments) > 0 THEN
        FOR j_att_item IN SELECT * FROM jsonb_array_elements(j_attachments)
        LOOP
            INSERT INTO public.lead_attachments (
                lead_id, file_url, file_name, file_type,
                active, registration_date, user_registration_id
            )
            VALUES (
                p_lead_id,
                j_att_item->>'url',
                j_att_item->>'name',
                j_att_item->>'type',
                'Y', NOW(), p_user_id
            );
        END LOOP;
    END IF;

    IF v_is_doc_pending THEN
        -- OS/OP: cuota por el total, PENDIENTE, y ninguna fila en payments. El
        -- placeholder pendiente que crean las otras ramas le haria creer a FICO
        -- que hay un pago declarado esperando conciliacion, y aqui no hay nada.
        INSERT INTO public.payment_installments (
            enrollment_id, installment_number, amount, due_date, cat_status, notes
        )
        VALUES (
            v_enrollment_id, 1, v_current_total, NOW()::date,
            c_inst_pending, 'OS/OP - Inscrito con inicial pendiente, sin pago recibido'
        )
        RETURNING installment_id INTO v_installment_id;

    ELSIF v_cat_channel_pay = c_channel_general THEN
        IF v_cat_payment_way_alias = 'we_payment_way_installments' AND v_adelanto > 0 THEN
            INSERT INTO public.payment_installments
                (enrollment_id, installment_number, amount, due_date, cat_status, notes)
            VALUES
                (v_enrollment_id, 0, v_adelanto, NOW()::date, c_inst_pending, 'Reserva / Pago inicial – Pendiente conciliación')
            RETURNING installment_id INTO v_installment_id;

            INSERT INTO public.payments
                (enrollment_id, installment_id, amount, cat_payment_type, cat_method_payment, cat_settlement_status, user_registration_id, registration_date)
            VALUES
                (v_enrollment_id, v_installment_id, v_adelanto, c_pay_type_initial, v_cat_method_pay, c_pay_status_pending, p_user_id, NOW());

            v_plan      := j_insc -> 'installment_plan';
            v_remainder := ROUND(v_current_total - v_adelanto, 2);
            v_plan_sum  := 0;

            FOR v_item IN SELECT * FROM jsonb_array_elements(v_plan)
            LOOP
                v_plan_sum := v_plan_sum + ROUND((v_item->>'amount')::numeric, 2);
            END LOOP;

            IF ABS(v_plan_sum - v_remainder) > 0.01 THEN
                OPEN p_cur FOR SELECT 2 AS result,
                    'La suma del plan de cuotas (' || v_plan_sum || ') no coincide con el saldo a financiar (' || v_remainder || '). Ajuste los montos e intente nuevamente.' AS message,
                    NULL::int AS enrollment_id;
                RETURN;
            END IF;

            FOR v_item IN SELECT * FROM jsonb_array_elements(v_plan)
            LOOP
                INSERT INTO public.payment_installments
                    (enrollment_id, installment_number, amount, due_date, cat_status, notes)
                VALUES (
                    v_enrollment_id,
                    (v_item->>'installment_number')::int,
                    ROUND((v_item->>'amount')::numeric, 2),
                    (v_item->>'due_date')::date,
                    c_inst_draft,
                    'Cuota ' || (v_item->>'installment_number') || ' – Pendiente aprobación Finanzas'
                );
            END LOOP;
        ELSE
            INSERT INTO public.payment_installments (
                enrollment_id, installment_number, amount, due_date, cat_status, notes
            )
            VALUES (
                v_enrollment_id, 1, v_current_total, NOW()::date,
                c_pay_settlement_pend, 'Pago al contado – Pendiente verificación'
            )
            RETURNING installment_id INTO v_installment_id;

            INSERT INTO public.payments (
                enrollment_id, installment_id, amount, cat_payment_type, cat_method_payment,
                cat_settlement_status, cat_token_provider, user_registration_id, registration_date
            )
            VALUES (
                v_enrollment_id, v_installment_id, v_current_total,
                c_pay_type_initial, v_cat_method_pay,
                c_pay_settlement_pend, NULL, p_user_id, NOW()
            );
        END IF;
    ELSIF v_cat_channel_pay = c_channel_token THEN
        INSERT INTO public.payment_installments (
            enrollment_id, installment_number, amount, due_date, cat_status, notes
        )
        VALUES (
            v_enrollment_id, 1, v_current_total, NOW()::date,
            c_pay_settlement_pend, 'Pago vía link/token – Pendiente confirmación de proveedor'
        )
        RETURNING installment_id INTO v_installment_id;

        INSERT INTO public.payments (
            enrollment_id, installment_id, amount, cat_payment_type, cat_method_payment,
            cat_settlement_status, cat_token_provider, user_registration_id, registration_date
        )
        VALUES (
            v_enrollment_id, v_installment_id, v_current_total,
            c_pay_type_initial, NULL,
            c_pay_settlement_pend, v_cat_token_prov, p_user_id, NOW()
        );
    ELSIF v_cat_channel_pay = c_channel_web THEN
        INSERT INTO public.payment_installments (
            enrollment_id, installment_number, amount, due_date, cat_status, notes
        )
        VALUES (
            v_enrollment_id, 1, v_current_total, NOW()::date,
            c_pay_settlement_pend, 'Pago web – Pendiente conciliación con pasarela'
        )
        RETURNING installment_id INTO v_installment_id;

        INSERT INTO public.payments (
            enrollment_id, installment_id, amount, cat_payment_type, cat_method_payment,
            cat_settlement_status, cat_token_provider, user_registration_id, registration_date
        )
        VALUES (
            v_enrollment_id, v_installment_id, v_current_total,
            c_pay_type_initial, NULL,
            c_pay_settlement_pend, NULL, p_user_id, NOW()
        );
    END IF;

    UPDATE public.leads
    SET enrollment_id        = v_enrollment_id,
        cat_status_lead      = c_lead_status_insc,
        origin_email         = v_email,
        user_modification_id = p_user_id,
        modification_date    = NOW()
    WHERE lead_id = p_lead_id;

    -- [RESUBMIT] Mensaje diferenciado según alta nueva o subsanación.
    IF v_is_resubmit THEN
        OPEN p_cur FOR
            SELECT 1 AS result, 'Inscripción subsanada y reenviada a FICO correctamente.' AS message, v_enrollment_id AS enrollment_id;
    ELSE
        OPEN p_cur FOR
            SELECT 1 AS result, 'Matrícula registrada correctamente.' AS message, v_enrollment_id AS enrollment_id;
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        OPEN p_cur FOR
            SELECT 0 AS result, SQLERRM AS message, NULL::int AS enrollment_id;
END;
$procedure$

