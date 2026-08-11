CREATE OR REPLACE PROCEDURE public.sp_instructor_get(IN p_instructor_id integer, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
BEGIN
  IF p_cur IS NULL THEN
    p_cur := 'cur_sp_instructor_get';
  END IF;

  OPEN p_cur FOR
    SELECT
      i.instructor_id,
      i.person_id,
      i.profile_resume,
      p.first_name,
      p.last_name,
      p.mother_last_name,
      p.document_number,
      p.cat_type_document,
      td.description AS cat_type_document_label,
      p.cat_occupation,
      oc.description AS cat_occupation_label,
      p.cat_person_status,
      ps.description AS cat_person_status_label,
      p.cat_country,
      co.description AS cat_country_label,
      p.birthday,

      -- Campos de texto Instructor
      i.linkedin,
      i.cv_url,
      i.cv_documents_url,
      i.relevant_company,
      i.relevant_work,

      p.active AS person_active,
      i.active AS instructor_active,

      -- Auditoría
      p.user_registration_id AS person_user_registration_id,
      p.user_modification_id AS person_user_modification_id,
      p.registration_date    AS person_registration_date,
      p.modification_date    AS person_modification_date,
      i.user_registration_id AS instructor_user_registration_id,
      i.user_modification_id AS instructor_user_modification_id,
      i.registration_date    AS instructor_registration_date,
      i.modification_date    AS instructor_modification_date,

      -- 1. SUBQUERY FINANCIALS
      (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'instructor_financial_id', f.instructor_financial_id,
              'bank_name',              f.bank_name,
              'cat_rate_pay_id',        f.cat_rate_pay_id,
              'cat_rate_pay_label',     rp.description,
              'cat_payment_type',       f.cat_payment_type,
              'cat_currency',           f.cat_currency,
              'observations',           f.observations,
              'active',                 f.active,
              'attachments', COALESCE(
                (
                  SELECT jsonb_agg(fa.document_url)
                  FROM public.instructor_financial_attachments fa
                  WHERE fa.instructor_financial_id = f.instructor_financial_id
                    AND fa.active = 'Y'
                ),
                '[]'::jsonb
              )
            ) ORDER BY f.instructor_financial_id ASC
          ),
          '[]'::jsonb
        )
        FROM public.instructor_financials f
        LEFT JOIN public."catalog" rp ON rp.catalog_id = f.cat_rate_pay_id
        WHERE f.instructor_id = i.instructor_id
          AND f.active = 'Y'
      ) AS financials,

      -- 2. SUBQUERY PROGRAMS
      (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'instructor_program_id', ip.instructor_program_id,
              'program_id',            ip.program_id,
              'program_name',          pr.program_name,
              'profile_summary',       ip.profile_summary,
              'active',                ip.active,
              'registration_date',     ip.registration_date
            ) ORDER BY ip.instructor_program_id ASC
          ),
          '[]'::jsonb
        )
        FROM public.instructor_programs ip
        LEFT JOIN public.programs pr ON pr.program_id = ip.program_id
        WHERE ip.instructor_id = i.instructor_id
          AND ip.active = 'Y'
      ) AS programs,

      -- 3. EMAIL (FIX: LIMIT 1 para evitar "more than one row returned")
      (
        SELECT pco.value
        FROM public.person_contacts pco
        WHERE pco.person_id = p.person_id
          AND pco.cat_way_contact = 2319
        ORDER BY pco.person_contact_id DESC
        LIMIT 1
      ) AS email,

      -- 4. PHONE (FIX: LIMIT 1 para evitar "more than one row returned")
      (
        SELECT pco.value
        FROM public.person_contacts pco
        WHERE pco.person_id = p.person_id
          AND pco.cat_way_contact = 2318
        ORDER BY pco.person_contact_id DESC
        LIMIT 1
      ) AS phone

    FROM public.instructors i
    JOIN public.persons p ON p.person_id = i.person_id
    LEFT JOIN public."catalog" td ON td.catalog_id = p.cat_type_document
    LEFT JOIN public."catalog" oc ON oc.catalog_id = p.cat_occupation
    LEFT JOIN public."catalog" ps ON ps.catalog_id = p.cat_person_status
    LEFT JOIN public."catalog" co ON co.catalog_id = p.cat_country
    WHERE i.instructor_id = p_instructor_id;
END;
$procedure$
