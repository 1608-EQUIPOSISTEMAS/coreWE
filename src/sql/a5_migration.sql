-- =====================================================================
-- A5 MIGRATION FEATURE
-- =====================================================================
-- Cuando una edicion pasa al segmento A5 (cancelacion), las inscripciones
-- no anuladas/retiradas se "proponen" para migrar a una edicion destino
-- del mismo program_version_id.
--
-- Modelo "intent record": se crea una inscripcion paralela en estado
-- PENDING_REVIEW con seller_agent_id NULL. La inscripcion original pasa
-- a RP y se vincula a la nueva via replaces_enrollment_id.
--
-- Aplicar en este orden:
--   1) ALTER TABLE enrollments
--   2) INSERT catalogo we_enrollment_status_pending_review
--   3) sp_edition_a5_pending_enrollments
--   4) sp_edition_a5_migration_execute
--   5) sp_enrollment_pending_review_approve
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) ALTER TABLE: trazabilidad cruzada entre inscripcion original y nueva
-- ---------------------------------------------------------------------
ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS replaces_enrollment_id INTEGER
    REFERENCES public.enrollments(enrollment_id);

COMMENT ON COLUMN public.enrollments.replaces_enrollment_id IS
  'Si esta inscripcion fue creada por migracion A5, apunta a la inscripcion original (que queda en RP). NULL para inscripciones de alta normal.';

CREATE INDEX IF NOT EXISTS idx_enrollments_replaces
  ON public.enrollments(replaces_enrollment_id)
  WHERE replaces_enrollment_id IS NOT NULL;


-- ---------------------------------------------------------------------
-- 2) Catalogo: estado "Pendiente a revisar"
-- AJUSTAR el cat_parent_id si el catalogo de estados tiene padre propio.
-- Si la columna se llama distinto en tu cat_table, ajustar nombres.
-- ---------------------------------------------------------------------
INSERT INTO public.cat_table (alias, description, active)
SELECT 'we_enrollment_status_pending_review',
       'Pendiente a revisar (migracion por cancelacion A5)',
       'Y'
WHERE NOT EXISTS (
  SELECT 1 FROM public.cat_table WHERE alias = 'we_enrollment_status_pending_review'
);


-- ---------------------------------------------------------------------
-- 3) Lista alumnos vigentes en una edicion + datos para el modal A5
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE public.sp_edition_a5_pending_enrollments(
    p_edition_num_id INTEGER,
    INOUT p_cur REFCURSOR
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_retired_id INTEGER;
    v_pending_review_id INTEGER;
    v_rp_id INTEGER;
BEGIN
    SELECT id INTO v_retired_id
      FROM public.cat_table WHERE alias = 'we_enrollment_status_retired';
    SELECT id INTO v_pending_review_id
      FROM public.cat_table WHERE alias = 'we_enrollment_status_pending_review';
    SELECT id INTO v_rp_id
      FROM public.cat_table WHERE alias = 'we_enrollment_status_reprogrammed';

    OPEN p_cur FOR
    SELECT
        e.enrollment_id,
        e.customer_id,
        e.program_version_id,
        e.program_edition_id,
        e.parent_enrollment_id,
        e.seller_agent_id,
        e.cat_type_status,
        e.cat_fico_status,
        e.total_amount,
        per.first_name,
        per.last_name,
        per.document_number,
        TRIM(COALESCE(per.first_name, '') || ' ' || COALESCE(per.last_name, '')) AS full_name,
        pv.abbreviation AS program_name,
        pe.global_code AS edition_code,
        pe.start_date AS edition_start_date,
        (e.parent_enrollment_id IS NOT NULL) AS is_child,
        ppv.abbreviation AS parent_program_name,
        ppe.global_code AS parent_edition_code,
        COALESCE(seller.first_name || ' ' || seller.last_name, 'S/A') AS seller_name,
        COALESCE((
            SELECT SUM(pi.amount)
              FROM public.payment_installments pi
             WHERE pi.enrollment_id = e.enrollment_id
               AND pi.cat_status IN (4454, 2471)
        ), 0) AS amount_paid
    FROM public.enrollments e
    JOIN public.customers c ON c.customer_id = e.customer_id
    JOIN public.persons per ON per.person_id = c.person_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.enrollments p_e ON p_e.enrollment_id = e.parent_enrollment_id
    LEFT JOIN public.program_versions ppv ON ppv.program_version_id = p_e.program_version_id
    LEFT JOIN public.program_editions ppe ON ppe.edition_num_id = p_e.program_edition_id
    LEFT JOIN public.persons seller ON seller.person_id = e.seller_agent_id
    WHERE e.program_edition_id = p_edition_num_id
      AND e.active = 'Y'
      AND e.cat_type_status NOT IN (
          COALESCE(v_retired_id, -1),
          COALESCE(v_pending_review_id, -1),
          COALESCE(v_rp_id, -1)
      )
    ORDER BY e.parent_enrollment_id NULLS FIRST, e.enrollment_id;
END;
$$;


-- ---------------------------------------------------------------------
-- 4) Migracion masiva + cancelacion A5 (transaccion atomica)
-- ---------------------------------------------------------------------
-- p_payload: {
--   edition_num_id: <int>,
--   migrations: [{ enrollment_id, target_edition_id }],
--   justificacion: <text>,
--   a5_segment_id: <int>   -- id del cat_segment 'A5' para SET cat_segment_id
-- }
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE public.sp_edition_a5_migration_execute(
    p_payload JSONB,
    p_user_id INTEGER,
    INOUT p_cur REFCURSOR
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_edition_num_id INTEGER;
    v_migrations JSONB;
    v_justificacion TEXT;
    v_a5_segment_id INTEGER;

    v_pending_review_id INTEGER;
    v_rp_id INTEGER;
    v_fico_pending_id INTEGER;

    v_migration JSONB;
    v_enrollment_id INTEGER;
    v_target_edition_id INTEGER;
    v_new_enrollment_id INTEGER;
    v_origin RECORD;
    v_target RECORD;
    v_count INTEGER := 0;
BEGIN
    v_edition_num_id := (p_payload->>'edition_num_id')::INTEGER;
    v_migrations := p_payload->'migrations';
    v_justificacion := COALESCE(p_payload->>'justificacion', '');
    v_a5_segment_id := NULLIF(p_payload->>'a5_segment_id', '')::INTEGER;

    IF v_edition_num_id IS NULL OR v_migrations IS NULL OR jsonb_array_length(v_migrations) = 0 THEN
        OPEN p_cur FOR SELECT 0 AS result, 'Payload invalido: faltan edition_num_id o migrations' AS message, 0 AS migrated_count;
        RETURN;
    END IF;

    IF length(trim(v_justificacion)) = 0 THEN
        OPEN p_cur FOR SELECT 0 AS result, 'Justificacion obligatoria' AS message, 0 AS migrated_count;
        RETURN;
    END IF;

    SELECT id INTO v_pending_review_id
      FROM public.cat_table WHERE alias = 'we_enrollment_status_pending_review';
    SELECT id INTO v_rp_id
      FROM public.cat_table WHERE alias = 'we_enrollment_status_reprogrammed';
    SELECT id INTO v_fico_pending_id
      FROM public.cat_table WHERE alias = 'we_enrollment_status_pending';

    IF v_pending_review_id IS NULL OR v_rp_id IS NULL THEN
        OPEN p_cur FOR SELECT 0 AS result,
          'Catalogos requeridos no existen (pending_review o reprogrammed)' AS message,
          0 AS migrated_count;
        RETURN;
    END IF;

    -- Pre-vuelo: validar TODAS las migraciones antes de tocar nada.
    -- Si una falla, abortamos sin estado parcial.
    FOR v_migration IN SELECT * FROM jsonb_array_elements(v_migrations) LOOP
        v_enrollment_id := (v_migration->>'enrollment_id')::INTEGER;
        v_target_edition_id := (v_migration->>'target_edition_id')::INTEGER;

        SELECT e.enrollment_id, e.program_version_id, e.program_edition_id
          INTO v_origin
          FROM public.enrollments e
         WHERE e.enrollment_id = v_enrollment_id
           AND e.program_edition_id = v_edition_num_id;

        IF NOT FOUND THEN
            OPEN p_cur FOR SELECT 0 AS result,
              ('Inscripcion ' || v_enrollment_id || ' no pertenece a la edicion origen') AS message,
              0 AS migrated_count;
            RETURN;
        END IF;

        SELECT pe.edition_num_id, pe.program_version_id, pe.start_date, pe.active,
               cs.alias AS segment_alias
          INTO v_target
          FROM public.program_editions pe
          LEFT JOIN public.cat_table cs ON cs.id = pe.cat_segment_id
         WHERE pe.edition_num_id = v_target_edition_id;

        IF NOT FOUND THEN
            OPEN p_cur FOR SELECT 0 AS result,
              ('Edicion destino ' || v_target_edition_id || ' no existe') AS message,
              0 AS migrated_count;
            RETURN;
        END IF;

        IF v_target.program_version_id <> v_origin.program_version_id THEN
            OPEN p_cur FOR SELECT 0 AS result,
              ('Edicion destino ' || v_target_edition_id || ' no pertenece al mismo programa') AS message,
              0 AS migrated_count;
            RETURN;
        END IF;

        IF COALESCE(v_target.segment_alias, '') = 'we_segment_a5' OR v_target.active = 'N' THEN
            OPEN p_cur FOR SELECT 0 AS result,
              ('Edicion destino ' || v_target_edition_id || ' no esta vigente') AS message,
              0 AS migrated_count;
            RETURN;
        END IF;
    END LOOP;

    -- Ejecucion: clonar + marcar RP + audit logs
    FOR v_migration IN SELECT * FROM jsonb_array_elements(v_migrations) LOOP
        v_enrollment_id := (v_migration->>'enrollment_id')::INTEGER;
        v_target_edition_id := (v_migration->>'target_edition_id')::INTEGER;

        -- Clona la inscripcion: hereda todo lo identificatorio, NO pagos
        -- (total_amount/discount/list_price = 0). Los pagos viven en el original
        -- hasta que se apruebe la pendiente.
        INSERT INTO public.enrollments (
            customer_id, program_version_id, program_edition_id,
            parent_enrollment_id, total_amount, discount_amount, list_price,
            cat_currency, cat_inscription_modality, cat_payment_channel, cat_payment_plan,
            cat_fico_status, cat_type_status, cat_certificate_status, cat_profile_id,
            seller_agent_id, active, user_registration_id, registration_date,
            replaces_enrollment_id, notes
        )
        SELECT
            customer_id, program_version_id, v_target_edition_id,
            parent_enrollment_id, 0, 0, 0,
            cat_currency, cat_inscription_modality, cat_payment_channel, cat_payment_plan,
            COALESCE(v_fico_pending_id, cat_fico_status),  -- nace pending FICO; al aprobar pasa a checked
            v_pending_review_id, cat_certificate_status, cat_profile_id,
            NULL,                              -- seller_agent_id = S/A
            'Y', p_user_id, NOW(),
            enrollment_id,                     -- replaces_enrollment_id
            'Migracion A5 desde inscripcion #' || enrollment_id
        FROM public.enrollments
        WHERE enrollment_id = v_enrollment_id
        RETURNING enrollment_id INTO v_new_enrollment_id;

        -- Marcar original como RP
        UPDATE public.enrollments
           SET cat_type_status = v_rp_id
         WHERE enrollment_id = v_enrollment_id;

        -- Audit en original
        INSERT INTO public.enrollment_audit_log (
            enrollment_id, action, performed_by, justificacion, details
        ) VALUES (
            v_enrollment_id,
            'edition_cancelled_a5_migrated',
            p_user_id,
            v_justificacion,
            'Edicion origen cancelada (A5). Inscripcion clonada a #' || v_new_enrollment_id
                || ' (edicion destino #' || v_target_edition_id || ') en estado pendiente a revisar.'
        );

        -- Audit en nuevo
        INSERT INTO public.enrollment_audit_log (
            enrollment_id, action, performed_by, justificacion, details
        ) VALUES (
            v_new_enrollment_id,
            'created_from_a5_migration',
            p_user_id,
            v_justificacion,
            'Creada por migracion A5 desde inscripcion origen #' || v_enrollment_id
                || '. Pendiente confirmacion del alumno antes de inscribir en Odoo y enviar correo.'
        );

        -- Si el origen es HIJO de una ESP/Diplomado, audit en el padre (1 entrada)
        IF EXISTS (
            SELECT 1 FROM public.enrollments
             WHERE enrollment_id = v_enrollment_id
               AND parent_enrollment_id IS NOT NULL
        ) THEN
            INSERT INTO public.enrollment_audit_log (
                enrollment_id, action, performed_by, justificacion, details
            )
            SELECT
                e.parent_enrollment_id,
                'child_module_migrated',
                p_user_id,
                v_justificacion,
                'Modulo hijo migrado: inscripcion #' || v_enrollment_id || ' (RP) -> nueva #' || v_new_enrollment_id || ' (pendiente revision)'
              FROM public.enrollments e
             WHERE e.enrollment_id = v_enrollment_id;
        END IF;

        v_count := v_count + 1;
    END LOOP;

    -- Cancelar la edicion: cat_segment_id = A5 (si lo recibimos)
    IF v_a5_segment_id IS NOT NULL THEN
        UPDATE public.program_editions
           SET cat_segment_id = v_a5_segment_id
         WHERE edition_num_id = v_edition_num_id;
    END IF;

    OPEN p_cur FOR
    SELECT 1 AS result,
           'Migracion completada: ' || v_count || ' inscripcion(es) en estado pendiente a revisar.' AS message,
           v_count AS migrated_count;
END;
$$;


-- ---------------------------------------------------------------------
-- 5) Aprobar inscripcion pendiente a revisar (post-migracion A5)
--    Transfiere cuotas pendientes, marca activo, deja RP "definitivo"
--    en el origen. Odoo/correo lo dispara el caller en Node.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE public.sp_enrollment_pending_review_approve(
    p_payload JSONB,
    p_user_id INTEGER,
    INOUT p_cur REFCURSOR
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_enrollment_id INTEGER;
    v_pending_review_id INTEGER;
    v_tracking_id INTEGER;
    v_checked_id INTEGER;
    v_paid_status_a INTEGER := 4454;  -- legacy we_inst_paid
    v_paid_status_b INTEGER := 2471;  -- we_payment_status_paid

    v_enr RECORD;
    v_origin_id INTEGER;
    v_shifted INTEGER := 0;
    v_validations_copied INTEGER := 0;
BEGIN
    v_enrollment_id := (p_payload->>'enrollment_id')::INTEGER;

    IF v_enrollment_id IS NULL THEN
        OPEN p_cur FOR SELECT 0 AS result, 'enrollment_id requerido' AS message;
        RETURN;
    END IF;

    SELECT id INTO v_pending_review_id
      FROM public.cat_table WHERE alias = 'we_enrollment_status_pending_review';
    SELECT id INTO v_tracking_id
      FROM public.cat_table WHERE alias = 'we_enrollment_status_tracking';
    SELECT id INTO v_checked_id
      FROM public.cat_table WHERE alias = 'we_enrollment_status_checked';

    SELECT e.*, (e.parent_enrollment_id IS NOT NULL) AS is_child
      INTO v_enr
      FROM public.enrollments e
     WHERE e.enrollment_id = v_enrollment_id;

    IF NOT FOUND THEN
        OPEN p_cur FOR SELECT 0 AS result, 'Inscripcion no encontrada' AS message;
        RETURN;
    END IF;

    IF v_enr.cat_type_status <> v_pending_review_id THEN
        OPEN p_cur FOR SELECT 0 AS result, 'La inscripcion no esta en estado pendiente a revisar' AS message;
        RETURN;
    END IF;

    v_origin_id := v_enr.replaces_enrollment_id;
    IF v_origin_id IS NULL THEN
        OPEN p_cur FOR SELECT 0 AS result, 'Inscripcion sin origen registrado (replaces_enrollment_id NULL)' AS message;
        RETURN;
    END IF;

    -- Transferir cuotas NO pagadas: del origen al nuevo
    WITH moved AS (
        UPDATE public.payment_installments
           SET enrollment_id = v_enrollment_id
         WHERE enrollment_id = v_origin_id
           AND cat_status NOT IN (v_paid_status_a, v_paid_status_b)
         RETURNING installment_id
    )
    SELECT COUNT(*) INTO v_shifted FROM moved;

    -- Transferir monto pendiente: copiar total_amount/discount/list_price del origen
    UPDATE public.enrollments new_e
       SET total_amount = old_e.total_amount,
           discount_amount = old_e.discount_amount,
           list_price = old_e.list_price,
           cat_type_status = COALESCE(v_tracking_id, new_e.cat_type_status),
           cat_fico_status = COALESCE(v_checked_id, new_e.cat_fico_status)
      FROM public.enrollments old_e
     WHERE new_e.enrollment_id = v_enrollment_id
       AND old_e.enrollment_id = v_origin_id;

    -- Si el origen era PADRE, copiar enrollment_validations (convalidaciones)
    -- para que createChildEnrollments (caller Node) NO reinscriba modulos convalidados.
    IF v_enr.parent_enrollment_id IS NULL THEN
        INSERT INTO public.enrollment_validations (enrollment_id, child_program_version_id, active, created_by, created_at)
        SELECT v_enrollment_id, child_program_version_id, active, p_user_id, NOW()
          FROM public.enrollment_validations
         WHERE enrollment_id = v_origin_id
           AND active = 'Y'
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_validations_copied = ROW_COUNT;
    END IF;

    -- Audit
    INSERT INTO public.enrollment_audit_log (
        enrollment_id, action, performed_by, details
    ) VALUES (
        v_enrollment_id,
        'pending_review_approved',
        p_user_id,
        'Aprobada migracion. Cuotas trasladadas: ' || v_shifted
            || COALESCE('. Convalidaciones copiadas: ' || NULLIF(v_validations_copied, 0), '')
            || '. Origen #' || v_origin_id || ' queda en RP definitivo.'
    );

    INSERT INTO public.enrollment_audit_log (
        enrollment_id, action, performed_by, details
    ) VALUES (
        v_origin_id,
        'rp_finalized',
        p_user_id,
        'Reprogramacion finalizada. Inscripcion sucesora #' || v_enrollment_id || ' aprobada.'
    );

    OPEN p_cur FOR
    SELECT 1 AS result,
           'Inscripcion aprobada' AS message,
           v_enrollment_id AS enrollment_id,
           v_origin_id AS origin_enrollment_id,
           v_shifted AS installments_shifted,
           v_validations_copied AS validations_copied,
           (v_enr.parent_enrollment_id IS NULL) AS is_parent;
END;
$$;
