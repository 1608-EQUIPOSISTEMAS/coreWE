CREATE OR REPLACE PROCEDURE sp_fico_enrollment_list(
    IN _filters_text TEXT DEFAULT '{}'::TEXT,
    INOUT p_cur REFCURSOR DEFAULT 'cur_default'::REFCURSOR
) AS $$
DECLARE
    _filters    JSONB;
    _q          TEXT;
    _date_from  TEXT;
    _date_to    TEXT;
    _start_from TEXT;
    _start_to   TEXT;
    _page       INT;
    _size       INT;
    _offset     INT;
BEGIN
    _filters    := _filters_text::JSONB;
    _q          := _filters->>'q';
    _date_from  := _filters->>'date_from';
    _date_to    := _filters->>'date_to';
    _start_from := _filters->>'edition_start_from';
    _start_to   := _filters->>'edition_start_to';
    _page       := COALESCE((_filters->>'page')::INT, 1);
    _size       := COALESCE((_filters->>'size')::INT, 25);
    _offset     := (_page - 1) * _size;

    OPEN p_cur FOR
    SELECT
        COUNT(*) OVER()::BIGINT AS total_count,
        v."ID"::TEXT                    AS enrollment_id,
        v."FECHA DE REGISTRO"::TEXT     AS registration_date,
        v."TIPO DE PROGRAMA"::TEXT      AS program_type,
        v."MODALIDAD DE PROGRAMA"::TEXT AS program_modality,
        v."NOMBRE DEL PROGRAMA"::TEXT   AS program_name,
        v."COD"::TEXT                   AS edition_code,
        v."DNI"::TEXT                   AS document_number,
        v."NOMBRES COMPLETOS"::TEXT     AS student_full_name,
        v."CELULAR"::TEXT               AS phone,
        v."CORREO"::TEXT                AS email,
        v."OCUP."::TEXT                 AS occupation_label,
        v."TIP_CLIENTE"::TEXT           AS client_type_label,
        v."TIP_MEMBER"::TEXT            AS member_type_label,
        v."ESTADO ALUMNO"::TEXT         AS student_status,
        v."MODALIDAD"::TEXT             AS modality,
        v."TIPO ALUMNO"::TEXT           AS student_type_label,
        v."FECHA DE INICIO"::TEXT       AS start_date,
        v."ASESOR"::TEXT                AS seller_agent_name,
        v."TIPO DE PAGO"::TEXT          AS payment_type,
        v."DSTC. PRINCIPAL"::TEXT       AS main_discount,
        v."DSTC'S ADICIONALES"::TEXT    AS additional_discounts,
        v."FECHA DE PAGO"::TEXT         AS pay_date,
        v."COMPROBANTES DE PAGO"::TEXT  AS payment_vouchers,
        v."CONS. ESTUDIANTE"::TEXT      AS student_record,
        v."INFORMACION ADICIONAL"::TEXT AS additional_info,
        v."CONFIRMACIÓN"::TEXT          AS confirmation,
        v."CANAL DE PAGO"::TEXT         AS payment_channel,
        v."PRECIO LISTA"::TEXT          AS list_price,
        v."TOTAL A PAGAR"::TEXT         AS total_to_pay,
        v."TOTAL DESCONTADO"::TEXT      AS total_discounted,
        v."RESERVA_AMOUNT"::TEXT        AS reservation_amount,
        v."PAID_AMOUNT"::TEXT           AS paid_amount,
        (SELECT c_cur.description FROM catalog c_cur WHERE c_cur.catalog_id = (SELECT e2.cat_currency FROM enrollments e2 WHERE e2.enrollment_id = v."ID")) AS currency_label,
        (SELECT c_mp.description FROM payments py JOIN catalog c_mp ON c_mp.catalog_id = py.cat_method_payment WHERE py.enrollment_id = v."ID" AND py.active = 'Y' ORDER BY py.payment_date DESC LIMIT 1) AS method_payment_label,
        (SELECT c_be.description FROM payments py JOIN bank_accounts ba ON ba.account_id = py.settled_in_account_id JOIN catalog c_be ON c_be.catalog_id = ba.business_entity_catalog_id WHERE py.enrollment_id = v."ID" AND py.active = 'Y' ORDER BY py.payment_date DESC LIMIT 1) AS account_label,
        (SELECT c_tp.description FROM payments py JOIN catalog c_tp ON c_tp.catalog_id = py.cat_token_provider WHERE py.enrollment_id = v."ID" AND py.active = 'Y' AND py.cat_token_provider IS NOT NULL ORDER BY py.payment_date DESC LIMIT 1) AS token_provider_label,
        v."PLAN DE CUOTAS"::TEXT        AS installment_plan,
        v."FC1"::TEXT AS fc1, v."C1"::TEXT AS c1,
        v."FC2"::TEXT AS fc2, v."C2"::TEXT AS c2,
        v."FC3"::TEXT AS fc3, v."C3"::TEXT AS c3,
        v."FC4"::TEXT AS fc4, v."C4"::TEXT AS c4,
        v."FC5"::TEXT AS fc5, v."C5"::TEXT AS c5,
        v."FC6"::TEXT AS fc6, v."C6"::TEXT AS c6,
        v."FC7"::TEXT AS fc7, v."C7"::TEXT AS c7,
        v."FC8"::TEXT AS fc8, v."C8"::TEXT AS c8,
        v."KEYORIGINAL"::TEXT           AS key_original
    FROM "vw_enrollment_report_system" v
    WHERE
        (_q IS NULL OR _q = '' OR
            v."ID"::TEXT = _q OR
            v."NOMBRES COMPLETOS"::TEXT ILIKE '%' || _q || '%' OR
            v."DNI"::TEXT             ILIKE '%' || _q || '%' OR
            v."COD"::TEXT             ILIKE '%' || _q || '%' OR
            v."CORREO"::TEXT          ILIKE '%' || _q || '%' OR
            v."CELULAR"::TEXT         ILIKE '%' || _q || '%')
        AND (_date_from IS NULL OR v."FECHA DE REGISTRO"::DATE >= _date_from::DATE)
        AND (_date_to   IS NULL OR v."FECHA DE REGISTRO"::DATE <= _date_to::DATE)
        AND (_start_from IS NULL OR v."FECHA DE INICIO"::DATE >= _start_from::DATE)
        AND (_start_to   IS NULL OR v."FECHA DE INICIO"::DATE <= _start_to::DATE)
        AND (NOT _filters ? 'student_statuses'
             OR jsonb_array_length(COALESCE(_filters->'student_statuses','[]'::JSONB)) = 0
             OR v."ESTADO ALUMNO"::TEXT IN (SELECT jsonb_array_elements_text(_filters->'student_statuses')))
        AND (NOT _filters ? 'advisors'
             OR jsonb_array_length(COALESCE(_filters->'advisors','[]'::JSONB)) = 0
             OR v."ASESOR"::TEXT IN (SELECT jsonb_array_elements_text(_filters->'advisors')))
        AND (NOT _filters ? 'program_types'
             OR jsonb_array_length(COALESCE(_filters->'program_types','[]'::JSONB)) = 0
             OR v."TIPO DE PROGRAMA"::TEXT IN (SELECT jsonb_array_elements_text(_filters->'program_types')))
        AND (NOT _filters ? 'modalities'
             OR jsonb_array_length(COALESCE(_filters->'modalities','[]'::JSONB)) = 0
             OR v."MODALIDAD DE PROGRAMA"::TEXT IN (SELECT jsonb_array_elements_text(_filters->'modalities')))
        AND (NOT _filters ? 'payment_channels'
             OR jsonb_array_length(COALESCE(_filters->'payment_channels','[]'::JSONB)) = 0
             OR v."CANAL DE PAGO"::TEXT IN (SELECT jsonb_array_elements_text(_filters->'payment_channels')))
    ORDER BY v."ID" DESC
    LIMIT _size OFFSET _offset;
END;
$$ LANGUAGE plpgsql;
