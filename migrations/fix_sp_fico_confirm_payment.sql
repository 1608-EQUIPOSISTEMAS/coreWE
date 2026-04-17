CREATE OR REPLACE FUNCTION sp_fico_confirm_payment(p_data jsonb)
RETURNS TABLE(result integer, message text) AS $$
DECLARE
  v_action          text;
  v_enrollment_id   integer;
  v_user_id         integer;
  v_net_amount      numeric;
  v_inst            jsonb;
  v_inst_row        jsonb;
  v_inst_id         integer;
  v_now             timestamp := now();
BEGIN
  v_action        := p_data->>'action';
  v_enrollment_id := (p_data->>'enrollment_id')::integer;
  v_user_id       := (p_data->>'user_id')::integer;

  IF v_enrollment_id IS NULL THEN
    result := 0; message := 'enrollment_id requerido';
    RETURN NEXT; RETURN;
  END IF;

  -- ===========================================
  -- confirm_contado: pago unico al contado
  -- ===========================================
  IF v_action = 'confirm_contado' THEN

    SELECT (e.total_amount - e.discount_amount)
      INTO v_net_amount
      FROM public.enrollments e
     WHERE e.enrollment_id = v_enrollment_id;

    IF v_net_amount IS NULL THEN
      result := 0; message := 'Inscripcion no encontrada';
      RETURN NEXT; RETURN;
    END IF;

    SELECT pi.installment_id INTO v_inst_id
      FROM public.payment_installments pi
     WHERE pi.enrollment_id = v_enrollment_id
       AND pi.installment_number = 1
     LIMIT 1;

    IF v_inst_id IS NULL THEN
      INSERT INTO public.payment_installments
        (enrollment_id, installment_number, amount, due_date, cat_status, penalty_amount)
      VALUES
        (v_enrollment_id, 1, v_net_amount, CURRENT_DATE, 4454, 0)
      RETURNING installment_id INTO v_inst_id;
    ELSE
      UPDATE public.payment_installments
         SET cat_status = 4454, amount = v_net_amount
       WHERE installment_id = v_inst_id;
    END IF;

    INSERT INTO public.payments
      (enrollment_id, installment_id, amount, payment_date, transaction_code,
       cat_method_payment, cat_payment_type, cat_settlement_status,
       settled_in_account_id, active, user_registration_id, registration_date)
    VALUES
      (v_enrollment_id, v_inst_id, v_net_amount, v_now,
       COALESCE(p_data->>'transaction_code', ''),
       (p_data->>'cat_payment_medium')::integer,
       3115,
       2573,
       (p_data->>'bank_account_id')::integer,
       'Y', v_user_id, v_now);

    UPDATE public.enrollments
       SET cat_currency         = COALESCE((p_data->>'cat_currency')::integer, cat_currency),
           cat_fico_status      = 3052,
           user_modification_id = v_user_id,
           modification_date    = v_now
     WHERE enrollment_id = v_enrollment_id;

    result := 1; message := 'Pago al contado confirmado';
    RETURN NEXT; RETURN;

  -- ===========================================
  -- confirm_plan: confirmar plan de cuotas
  -- ===========================================
  ELSIF v_action = 'confirm_plan' THEN

    v_inst := p_data->'installments';

    IF v_inst IS NULL OR jsonb_array_length(v_inst) = 0 THEN
      result := 0; message := 'Se requieren cuotas para confirmar el plan';
      RETURN NEXT; RETURN;
    END IF;

    FOR v_inst_row IN SELECT * FROM jsonb_array_elements(v_inst)
    LOOP
      IF (v_inst_row->>'is_new')::boolean = true OR v_inst_row->>'installment_id' IS NULL THEN
        INSERT INTO public.payment_installments
          (enrollment_id, installment_number, amount, due_date, cat_status, penalty_amount)
        VALUES
          (v_enrollment_id,
           (v_inst_row->>'installment_number')::integer,
           (v_inst_row->>'amount')::numeric,
           NULLIF(v_inst_row->>'due_date', '')::date,
           4452,
           0);
      ELSE
        UPDATE public.payment_installments
           SET amount              = (v_inst_row->>'amount')::numeric,
               due_date            = NULLIF(v_inst_row->>'due_date', '')::date,
               installment_number  = (v_inst_row->>'installment_number')::integer
         WHERE installment_id = (v_inst_row->>'installment_id')::integer
           AND enrollment_id  = v_enrollment_id;
      END IF;
    END LOOP;

    DELETE FROM public.payment_installments
     WHERE enrollment_id = v_enrollment_id
       AND cat_status != 4454
       AND installment_id NOT IN (
         SELECT (elem->>'installment_id')::integer
           FROM jsonb_array_elements(v_inst) elem
          WHERE elem->>'installment_id' IS NOT NULL
       );

    -- Save initial payment financial data and create payment record
    SELECT pi.installment_id INTO v_inst_id
      FROM public.payment_installments pi
     WHERE pi.enrollment_id = v_enrollment_id
       AND pi.installment_number = 0
     LIMIT 1;

    IF v_inst_id IS NOT NULL AND (p_data->>'cat_payment_medium') IS NOT NULL THEN
      UPDATE public.payment_installments
         SET cat_status = 4454
       WHERE installment_id = v_inst_id;

      INSERT INTO public.payments
        (enrollment_id, installment_id, amount, payment_date, transaction_code,
         cat_method_payment, cat_payment_type, cat_settlement_status,
         settled_in_account_id, active, user_registration_id, registration_date)
      SELECT
        v_enrollment_id, v_inst_id, pi.amount, v_now,
        COALESCE(p_data->>'transaction_code', ''),
        (p_data->>'cat_payment_medium')::integer,
        3115,
        2573,
        (p_data->>'bank_account_id')::integer,
        'Y', v_user_id, v_now
      FROM public.payment_installments pi WHERE pi.installment_id = v_inst_id;
    END IF;

    UPDATE public.enrollments
       SET cat_currency         = COALESCE((p_data->>'cat_currency')::integer, cat_currency),
           cat_fico_status      = 3052,
           user_modification_id = v_user_id,
           modification_date    = v_now
     WHERE enrollment_id = v_enrollment_id;

    result := 1; message := 'Plan de cuotas confirmado';
    RETURN NEXT; RETURN;

  -- ===========================================
  -- update_installments_data: guardar datos financieros
  -- ===========================================
  ELSIF v_action = 'update_installments_data' THEN

    v_inst := p_data->'installments';

    IF v_inst IS NULL THEN
      result := 0; message := 'No hay cuotas para actualizar';
      RETURN NEXT; RETURN;
    END IF;

    FOR v_inst_row IN SELECT * FROM jsonb_array_elements(v_inst)
    LOOP
      IF (v_inst_row->>'is_new')::boolean = true OR v_inst_row->>'installment_id' IS NULL THEN
        INSERT INTO public.payment_installments
          (enrollment_id, installment_number, amount, due_date, cat_status, penalty_amount)
        VALUES
          (v_enrollment_id,
           (v_inst_row->>'installment_number')::integer,
           (v_inst_row->>'amount')::numeric,
           NULLIF(v_inst_row->>'due_date', '')::date,
           4451,
           0);
      ELSE
        UPDATE public.payment_installments
           SET amount              = (v_inst_row->>'amount')::numeric,
               due_date            = NULLIF(v_inst_row->>'due_date', '')::date,
               installment_number  = (v_inst_row->>'installment_number')::integer
         WHERE installment_id = (v_inst_row->>'installment_id')::integer
           AND enrollment_id  = v_enrollment_id;
      END IF;
    END LOOP;

    result := 1; message := 'Datos de cuotas actualizados';
    RETURN NEXT; RETURN;

  ELSE
    result := 0; message := 'Accion no reconocida: ' || COALESCE(v_action, 'null');
    RETURN NEXT; RETURN;
  END IF;

END;
$$ LANGUAGE plpgsql;
