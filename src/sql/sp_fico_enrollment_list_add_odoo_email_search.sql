-- Agrega enrollments.odoo_email al predicado de busqueda global del listado FICO.
-- El correo institucional de Odoo (p.ej. zarate.sebastian@weeducacion.edu.pe) no
-- existe en la vista materializada (columna CORREO trae el correo personal de la
-- inscripcion), pero si en enrollments.odoo_email. El SP ya hace LEFT JOIN a
-- enrollments (alias e), asi que el campo esta disponible sin joins adicionales.
-- Cambio aditivo: solo amplia las coincidencias, no altera ningun otro filtro.
--
-- Filtro only_scholarship (boolean): solo becados. Beca = el enrollment tiene
-- aplicado un descuento cuya descripcion contiene "BECA" (p.ej. "GLOBAL/BECA
-- 100%"), via enrollment_discounts -> discounts. Mismo patron que la deteccion
-- de la promo LAPTOP en edition.repository.js. NO se usa total 0 como proxy:
-- hay becados con certificado pendiente de pago y pagos-cero que no son beca.
CREATE OR REPLACE PROCEDURE public.sp_fico_enrollment_list(IN _filters_text text DEFAULT '{}'::text, INOUT p_cur refcursor DEFAULT 'cur_default'::refcursor)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
    _filters       JSONB;
    _q             TEXT;
    _date_from     TEXT;
    _date_to       TEXT;
    _start_from    TEXT;
    _start_to      TEXT;
    _payment_from  TEXT;   -- limite inferior del rango F.PAGO (ISO YYYY-MM-DD)
    _payment_to    TEXT;   -- limite superior del rango F.PAGO (ISO YYYY-MM-DD)
    _page          INT;
    _size          INT;
    _offset        INT;
BEGIN
    -- ISO con dia-mes-anio para parsear correctamente strings 'DD/MM/YYYY' de la MV.
    PERFORM set_config('datestyle', 'ISO, DMY', true);

    _filters       := _filters_text::JSONB;
    _q             := _filters->>'q';
    _date_from     := _filters->>'date_from';
    _date_to       := _filters->>'date_to';
    _start_from    := _filters->>'edition_start_from';
    _start_to      := _filters->>'edition_start_to';
    _payment_from  := _filters->>'payment_from';
    _payment_to    := _filters->>'payment_to';
    _page          := COALESCE((_filters->>'page')::INT, 1);
    _size          := COALESCE((_filters->>'size')::INT, 25);
    _offset        := (_page - 1) * _size;

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
        CASE
            WHEN NULLIF(TRIM(ag.resolved_alias), '') IS NULL AND e.agent_origin IS NOT NULL THEN e.agent_origin
            WHEN NULLIF(TRIM(ag.resolved_alias), '') IS NULL THEN NULL
            WHEN e.agent_origin IS NOT NULL THEN e.agent_origin || ' - ' || ag.resolved_alias
            ELSE ag.resolved_alias
        END AS seller_agent_name,
        e.agent_origin                                                    AS agent_origin,
        e.seller_agent_id                                                 AS seller_agent_id,
        NULLIF(TRIM(ag.resolved_alias), '')                               AS seller_agent_alias,
        v."TIPO DE PAGO"::TEXT          AS payment_type,
        v."DSTC. PRINCIPAL"::TEXT       AS main_discount,
        v."DSTC'S ADICIONALES"::TEXT    AS additional_discounts,
        COALESCE(
            NULLIF(v."FECHA DE PAGO"::TEXT, ''),
            TO_CHAR(
                (SELECT py.payment_date
                   FROM payments py
                  WHERE py.enrollment_id = v."ID"::INT AND py.active = 'Y'
                  ORDER BY py.payment_date ASC
                  LIMIT 1),
                'DD/MM/YYYY'
            ),
            TO_CHAR(e.registration_date, 'DD/MM/YYYY')
        ) AS pay_date,
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
        (SELECT c_cur.description FROM catalog c_cur WHERE c_cur.catalog_id = (SELECT e2.cat_currency FROM enrollments e2 WHERE e2.enrollment_id =  v."ID")) AS currency_label,
        (SELECT c_mp.description FROM payments py JOIN catalog c_mp ON c_mp.catalog_id = py.cat_method_payment WHERE py.enrollment_id = v."ID" AND  py.active = 'Y' ORDER BY py.payment_date DESC LIMIT 1) AS method_payment_label,
        (SELECT c_be.description FROM payments py JOIN bank_accounts ba ON ba.account_id = py.settled_in_account_id JOIN catalog c_be ON c_be.catalog_id =   ba.business_entity_catalog_id WHERE py.enrollment_id = v."ID" AND py.active = 'Y' ORDER BY py.payment_date DESC LIMIT 1) AS account_label,
        (SELECT c_tp.description FROM payments py JOIN catalog c_tp ON c_tp.catalog_id = py.cat_token_provider WHERE py.enrollment_id = v."ID" AND  py.active = 'Y' AND py.cat_token_provider IS NOT NULL ORDER BY py.payment_date DESC LIMIT 1) AS token_provider_label,
        v."PLAN DE CUOTAS"::TEXT        AS installment_plan,
        v."FC1"::TEXT AS fc1, v."C1"::TEXT AS c1,
        v."FC2"::TEXT AS fc2, v."C2"::TEXT AS c2,
        v."FC3"::TEXT AS fc3, v."C3"::TEXT AS c3,
        v."FC4"::TEXT AS fc4, v."C4"::TEXT AS c4,
        v."FC5"::TEXT AS fc5, v."C5"::TEXT AS c5,
        v."FC6"::TEXT AS fc6, v."C6"::TEXT AS c6,
        v."FC7"::TEXT AS fc7, v."C7"::TEXT AS c7,
        v."FC8"::TEXT AS fc8, v."C8"::TEXT AS c8,
        v."KEYORIGINAL"::TEXT           AS key_original,
        COALESCE((SELECT COUNT(*) FROM enrollment_validations ev WHERE ev.enrollment_id = v."ID"::INT), 0)::INT AS validations_count,
        -- Becado con certificado ya pagado (etiqueta "Certificar"): pinta la fila
        -- en el listado, mismo patron que has-laptop/has-claude.
        (EXISTS (
            SELECT 1 FROM public.enrollment_discounts edc
              JOIN public.discounts dc ON dc.discount_id = edc.discount_id
             WHERE edc.enrollment_id = v."ID"::INT AND dc.description ILIKE '%beca%')
         AND EXISTS (
            SELECT 1 FROM public."catalog" ccert
             WHERE ccert.catalog_id = e.cat_certificate_status
               AND ccert.alias = 'we_certificate_status_paid')
        ) AS beca_certificada
    FROM public.mv_enrollment_report_system v
    LEFT JOIN public.enrollments e ON e.enrollment_id = v."ID"::INT
    LEFT JOIN LATERAL (
        SELECT COALESCE(
            (SELECT u.alias
               FROM payment_tokens pt
               LEFT JOIN users u ON u.user_id = COALESCE(pt.requested_by, pt.created_by)
              WHERE pt.enrollment_id = v."ID"::INT
              ORDER BY pt.token_id ASC
              LIMIT 1),
            v."ASESOR"::TEXT
        ) AS resolved_alias
    ) ag ON TRUE
    -- Cascada del campo F.PAGO materializada como DATE para poder filtrarla por
    -- rango (payment_from / payment_to). Misma fuente que el SELECT del pay_date
    -- para garantizar que el filtro opera sobre el mismo valor que ve el usuario.
    LEFT JOIN LATERAL (
        SELECT COALESCE(
            NULLIF(v."FECHA DE PAGO"::TEXT, '')::DATE,
            (SELECT py.payment_date::DATE
               FROM payments py
              WHERE py.enrollment_id = v."ID"::INT AND py.active = 'Y'
              ORDER BY py.payment_date ASC
              LIMIT 1),
            e.registration_date::DATE
        ) AS computed_pay_date
    ) pd ON TRUE
    WHERE
        (_q IS NULL OR _q = '' OR
            v."ID"::TEXT = _q OR
            v."NOMBRES COMPLETOS"::TEXT ILIKE '%' || _q || '%' OR
            v."DNI"::TEXT             ILIKE '%' || _q || '%' OR
            v."COD"::TEXT             ILIKE '%' || _q || '%' OR
            v."CORREO"::TEXT          ILIKE '%' || _q || '%' OR
            e.odoo_email             ILIKE '%' || _q || '%' OR
            v."CELULAR"::TEXT         ILIKE '%' || _q || '%')
        AND (_date_from IS NULL OR v."FECHA DE REGISTRO"::DATE >= _date_from::DATE)
        AND (_date_to   IS NULL OR v."FECHA DE REGISTRO"::DATE <= _date_to::DATE)
        AND (_start_from IS NULL OR v."FECHA DE INICIO"::DATE >= _start_from::DATE)
        AND (_start_to   IS NULL OR v."FECHA DE INICIO"::DATE <= _start_to::DATE)
        AND (_payment_from IS NULL OR pd.computed_pay_date >= _payment_from::DATE)
        AND (_payment_to   IS NULL OR pd.computed_pay_date <= _payment_to::DATE)
        AND (NOT _filters ? 'student_statuses'
             OR jsonb_array_length(COALESCE(_filters->'student_statuses','[]'::JSONB)) = 0
             OR v."ESTADO ALUMNO"::TEXT IN (SELECT jsonb_array_elements_text(_filters->'student_statuses')))
        AND (NOT _filters ? 'confirmations'
             OR jsonb_array_length(COALESCE(_filters->'confirmations','[]'::JSONB)) = 0
             OR v."CONFIRMACIÓN"::TEXT IN (SELECT jsonb_array_elements_text(_filters->'confirmations')))
        AND (NOT _filters ? 'advisors'
             OR jsonb_array_length(COALESCE(_filters->'advisors','[]'::JSONB)) = 0
             OR (CASE
                    WHEN NULLIF(TRIM(ag.resolved_alias), '') IS NULL AND e.agent_origin IS NOT NULL THEN e.agent_origin
                    WHEN NULLIF(TRIM(ag.resolved_alias), '') IS NULL THEN NULL
                    WHEN e.agent_origin IS NOT NULL THEN e.agent_origin || ' - ' || ag.resolved_alias
                    ELSE ag.resolved_alias
                 END) IN (SELECT jsonb_array_elements_text(_filters->'advisors')))
        AND (NOT _filters ? 'program_types'
             OR jsonb_array_length(COALESCE(_filters->'program_types','[]'::JSONB)) = 0
             OR v."TIPO DE PROGRAMA"::TEXT IN (SELECT jsonb_array_elements_text(_filters->'program_types')))
        AND (NOT _filters ? 'modalities'
             OR jsonb_array_length(COALESCE(_filters->'modalities','[]'::JSONB)) = 0
             OR v."MODALIDAD DE PROGRAMA"::TEXT IN (SELECT jsonb_array_elements_text(_filters->'modalities')))
        AND (NOT _filters ? 'program_version_ids'
             OR jsonb_array_length(COALESCE(_filters->'program_version_ids','[]'::JSONB)) = 0
             OR e.program_version_id IN (SELECT (jsonb_array_elements_text(_filters->'program_version_ids'))::INT))
        AND (NOT _filters ? 'edition_num_ids'
             OR jsonb_array_length(COALESCE(_filters->'edition_num_ids','[]'::JSONB)) = 0
             OR e.program_edition_id IN (SELECT (jsonb_array_elements_text(_filters->'edition_num_ids'))::INT))
        AND (NOT _filters ? 'payment_channels'
             OR jsonb_array_length(COALESCE(_filters->'payment_channels','[]'::JSONB)) = 0
             OR v."CANAL DE PAGO"::TEXT IN (SELECT jsonb_array_elements_text(_filters->'payment_channels')))
        AND (NOT COALESCE((_filters->>'only_scholarship')::BOOLEAN, FALSE)
             OR EXISTS (
                SELECT 1
                  FROM public.enrollment_discounts edb
                  JOIN public.discounts db ON db.discount_id = edb.discount_id
                 WHERE edb.enrollment_id = v."ID"::INT
                   AND db.description ILIKE '%beca%'))
    ORDER BY v."ID" DESC
    LIMIT _size OFFSET _offset;
END;
$procedure$
