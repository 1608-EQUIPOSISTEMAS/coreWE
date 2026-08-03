-- Definicion canonica de sp_edition_caller (volcada desde produccion).
-- Editar ESTE archivo y desplegarlo; no hacer read-modify-write contra la BD.
-- Los dos overloads (con y sin p_month/p_year) se mantienen porque el 5-arg
-- sigue existiendo en la BD, aunque hoy nadie lo llama.

CREATE OR REPLACE PROCEDURE public.sp_edition_caller(IN p_program_version_id integer DEFAULT NULL::integer, IN p_active character DEFAULT 'Y'::bpchar, IN p_cat_status_edition integer DEFAULT NULL::integer, IN p_q text DEFAULT NULL::text, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
BEGIN
  IF p_cur IS NULL THEN
    p_cur := 'cur_sp_edition_caller';
  END IF;

  OPEN p_cur FOR
  SELECT
    -- 🔹 edición
    e.edition_num_id,
    e.program_version_id,
    e.instructor_id,
    e.start_date,
    TO_CHAR(e.start_date, 'DD/MM/YYYY') AS start_date_label,
    e.end_date,
    e.cat_type_approved,
    cta.description        AS cat_type_approved_label,
    e.active,
    e.user_registration_id,
    e.user_modification_id,
    e.modification_date,
    e.registration_date,
    e.vacant,
    e.cat_status_edition,
    cse.description        AS cat_status_edition_label,
    e.specific_code,
    e.global_code,
    e.expedient,
    e.confirmation,
    e.preconfirmation,
    e.cat_day_combination_id,
    cdc.description        AS cat_day_combination_label,
    e.cat_hour_combination_id,
    chc.description        AS cat_hour_combination_label,

    -- 🔹 versión
    v.version_code,
    v.sessions,
    p.skem_clasification,

    -- 🔹 programa
    p.program_id,
    p.program_name,
    p.cat_type_program,
    ctp.description        AS cat_type_program_label,
    p.cat_model_modality,
    cmm.description        AS cat_model_modality_label,
    p.cat_category,
    cca.description        AS cat_category_label,

    -- 🔹 instructor (básico)
    i.person_id,
    per.first_name,
    per.last_name,
    per.mother_last_name,
    per.document_number,

    -- 🔹 label para IU
    TO_CHAR(e.start_date, 'DD/MM/YYYY') AS label_for_iu,
    concat_ws(' ', per.first_name, per.last_name) AS instructor_label

  FROM public.program_editions e
  JOIN public.program_versions v
    ON v.program_version_id = e.program_version_id
  JOIN public.programs p
    ON p.program_id = v.program_id
  LEFT JOIN public.instructors i
    ON i.instructor_id = e.instructor_id
  LEFT JOIN public.persons per
    ON per.person_id = i.person_id

  -- catalogs
  LEFT JOIN public."catalog" cta
    ON cta.catalog_id = e.cat_type_approved
  LEFT JOIN public."catalog" cse
    ON cse.catalog_id = e.cat_status_edition
  LEFT JOIN public."catalog" cdc
    ON cdc.catalog_id = e.cat_day_combination_id
  LEFT JOIN public."catalog" chc
    ON chc.catalog_id = e.cat_hour_combination_id
  LEFT JOIN public."catalog" ctp
    ON ctp.catalog_id = p.cat_type_program
  LEFT JOIN public."catalog" cmm
    ON cmm.catalog_id = p.cat_model_modality
  LEFT JOIN public."catalog" cca
    ON cca.catalog_id = p.cat_category

  WHERE
    (p_active IS NULL OR e.active = p_active)
    AND (p_cat_status_edition IS NULL OR e.cat_status_edition = p_cat_status_edition)
    AND (
      p_q IS NULL
      OR TO_CHAR(e.start_date, 'DD/MM/YYYY') ILIKE '%' || p_q || '%'
      OR p_q = ''
      OR e.global_code        ILIKE '%' || p_q || '%'
      OR p.skem_clasification ILIKE '%' || p_q || '%'
      OR e.specific_code      ILIKE '%' || p_q || '%'
      OR concat_ws(
          ' - ',
          e.global_code,
          e.clasification
        ) ILIKE '%' || p_q || '%'
    )
    AND e.cat_segment IS DISTINCT FROM (SELECT catalog_id FROM public.catalog WHERE alias = 'we_segment_a5')  -- A5 = edicion cancelada
    AND e.program_version_id = p_program_version_id
    AND e.start_date >= CURRENT_DATE  -- 🔹 NUEVO: Solo ediciones futuras o de hoy
  ORDER BY
    e.global_code,
    e.start_date DESC,
    e.edition_num_id
  LIMIT 30;
END;
$procedure$
;

CREATE OR REPLACE PROCEDURE public.sp_edition_caller(IN p_program_version_id integer DEFAULT NULL::integer, IN p_active character DEFAULT 'Y'::bpchar, IN p_cat_status_edition integer DEFAULT NULL::integer, IN p_q text DEFAULT NULL::text, IN p_month integer DEFAULT NULL::integer, IN p_year integer DEFAULT NULL::integer, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
BEGIN
  IF p_cur IS NULL THEN
    p_cur := 'cur_sp_edition_caller';
  END IF;
  OPEN p_cur FOR
  SELECT
    e.edition_num_id,
    e.program_version_id,
    e.instructor_id,
    e.start_date,
    TO_CHAR(e.start_date, 'DD/MM/YYYY') AS start_date_label,
    e.end_date,
    e.cat_type_approved,
    cta.description AS cat_type_approved_label,
    e.active,
    e.user_registration_id,
    e.user_modification_id,
    e.modification_date,
    e.registration_date,
    e.vacant,
    e.cat_status_edition,
    cse.description AS cat_status_edition_label,
    e.specific_code,
    e.global_code,
    e.expedient,
    e.confirmation,
    e.preconfirmation,
    e.cat_day_combination_id,
    cdc.description AS cat_day_combination_label,
    e.cat_hour_combination_id,
    chc.description AS cat_hour_combination_label,
    v.version_code,
    v.sessions,
    p.skem_clasification,
    p.program_id,
    p.program_name,
    p.cat_type_program,
    ctp.description AS cat_type_program_label,
    p.cat_model_modality,
    cmm.description AS cat_model_modality_label,
    p.cat_category,
    cca.description AS cat_category_label,
    i.person_id,
    per.first_name,
    per.last_name,
    per.mother_last_name,
    per.document_number,
    TO_CHAR(e.start_date, 'DD/MM/YYYY') AS label_for_iu,
    concat_ws(' ', per.first_name, per.last_name) AS instructor_label
  FROM public.program_editions e
  JOIN public.program_versions v ON v.program_version_id = e.program_version_id
  JOIN public.programs p ON p.program_id = v.program_id
  LEFT JOIN catalog chh ON chh.catalog_id = e.cat_segment
  LEFT JOIN public.instructors i ON i.instructor_id = e.instructor_id
  LEFT JOIN public.persons per ON per.person_id = i.person_id
  LEFT JOIN public.catalog cta ON cta.catalog_id = e.cat_type_approved
  LEFT JOIN public.catalog cse ON cse.catalog_id = e.cat_status_edition
  LEFT JOIN public.catalog cdc ON cdc.catalog_id = e.cat_day_combination_id
  LEFT JOIN public.catalog chc ON chc.catalog_id = e.cat_hour_combination_id
  LEFT JOIN public.catalog ctp ON ctp.catalog_id = p.cat_type_program
  LEFT JOIN public.catalog cmm ON cmm.catalog_id = p.cat_model_modality
  LEFT JOIN public.catalog cca ON cca.catalog_id = p.cat_category
  WHERE
    e.active = 'Y'
    AND (chh.catalog_id IS NULL OR chh.description <> 'A5')
    AND (p_cat_status_edition IS NULL OR e.cat_status_edition = p_cat_status_edition)
    AND (
      p_q IS NULL
      OR p_q = ''
      OR TO_CHAR(e.start_date, 'DD/MM/YYYY') ILIKE '%' || p_q || '%'
      OR e.global_code ILIKE '%' || p_q || '%'
      OR p.skem_clasification ILIKE '%' || p_q || '%'
      OR e.specific_code ILIKE '%' || p_q || '%'
    )
    AND e.cat_segment IS DISTINCT FROM (SELECT catalog_id FROM public.catalog WHERE alias = 'we_segment_a5')  -- A5 = edicion cancelada
    AND e.program_version_id = p_program_version_id
    AND (
      p_month IS NULL
      OR p_year IS NULL
      OR (
        e.start_date >= (make_date(p_year, p_month, 1) - INTERVAL '1 month')
        AND e.start_date <= make_date(p_year, 12, 31)
      )
    )
  ORDER BY
    e.global_code,
    e.start_date DESC,
    e.edition_num_id
  LIMIT 30;
END;
$procedure$
;
