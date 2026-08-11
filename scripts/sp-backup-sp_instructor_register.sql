CREATE OR REPLACE PROCEDURE public.sp_instructor_register(IN p_instructor jsonb, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
  v_person_id          int;
  v_instructor_id      int;
  v_doc                varchar(20);
  v_person_active      bpchar(1);
  v_instructor_active  bpchar(1);
  v_user_reg           int;
BEGIN
  IF p_cur IS NULL THEN
    p_cur := 'cur_sp_instructor_register';
  END IF;

  v_user_reg          := NULLIF(p_instructor->>'user_registration_id','')::int;
  v_person_active     := COALESCE(NULLIF(p_instructor->>'person_active','')::bpchar, 'Y');
  v_instructor_active := COALESCE(NULLIF(p_instructor->>'instructor_active','')::bpchar, 'Y');

  IF v_person_active NOT IN ('Y','N') THEN
    RAISE EXCEPTION 'Valor de person_active inválido: % (solo Y o N)', v_person_active
      USING ERRCODE = '22000';
  END IF;

  IF v_instructor_active NOT IN ('Y','N') THEN
    RAISE EXCEPTION 'Valor de instructor_active inválido: % (solo Y o N)', v_instructor_active
      USING ERRCODE = '22000';
  END IF;

  v_person_id := NULLIF(p_instructor->>'person_id','')::int;
  v_doc       := NULLIF(p_instructor->>'document_number','');

  IF v_person_id IS NULL THEN
    IF v_doc IS NOT NULL THEN
      SELECT person_id INTO v_person_id
      FROM public.persons
      WHERE document_number = v_doc;
    END IF;

    IF v_person_id IS NULL THEN
      INSERT INTO public.persons (
        first_name, last_name, mother_last_name,
        document_number, cat_occupation, cat_type_document,
        active, cat_person_status, user_registration_id,
        registration_date, cat_country, birthday
      ) VALUES (
        NULLIF(p_instructor->>'first_name',''),
        NULLIF(p_instructor->>'last_name',''),
        NULLIF(p_instructor->>'mother_last_name',''),
        v_doc,
        NULLIF(p_instructor->>'cat_occupation','')::int,
        NULLIF(p_instructor->>'cat_type_document','')::int,
        v_person_active,
        NULLIF(p_instructor->>'cat_person_status','')::int,
        v_user_reg,
        NOW(),
        NULLIF(p_instructor->>'cat_country','')::int,
        NULLIF(p_instructor->>'birthday','')::date
      )
      RETURNING person_id INTO v_person_id;
    END IF;
  END IF;

  IF (p_instructor->>'email') IS NOT NULL AND (p_instructor->>'email') <> '' THEN
    UPDATE public.person_contacts
    SET value = (p_instructor->>'email')
    WHERE person_id = v_person_id AND cat_way_contact = 2319;
    IF NOT FOUND THEN
      INSERT INTO public.person_contacts (person_id, cat_way_contact, value)
      VALUES (v_person_id, 2319, (p_instructor->>'email'));
    END IF;
  END IF;

  IF (p_instructor->>'phone') IS NOT NULL AND (p_instructor->>'phone') <> '' THEN
    UPDATE public.person_contacts
    SET value = (p_instructor->>'phone')
    WHERE person_id = v_person_id AND cat_way_contact = 2318;
    IF NOT FOUND THEN
      INSERT INTO public.person_contacts (person_id, cat_way_contact, value)
      VALUES (v_person_id, 2318, (p_instructor->>'phone'));
    END IF;
  END IF;

  SELECT instructor_id INTO v_instructor_id
  FROM public.instructors
  WHERE person_id = v_person_id;

  IF FOUND THEN
    RAISE EXCEPTION 'Ya existe un instructor para la persona % (instructor_id=%)', v_person_id, v_instructor_id
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.instructors (
    person_id, active, user_registration_id, registration_date,
    linkedin, relevant_company, relevant_work,
    profile_resume, cv_url, cv_documents_url
  ) VALUES (
    v_person_id, v_instructor_active, v_user_reg, NOW(),
    NULLIF(p_instructor->>'linkedin',''),
    NULLIF(p_instructor->>'relevant_company',''),
    NULLIF(p_instructor->>'relevant_work',''),
    NULLIF(p_instructor->>'profile_resume',''),
    NULLIF(p_instructor->>'cv_url',''),
    NULLIF(p_instructor->>'cv_documents_url','')
  )
  RETURNING instructor_id INTO v_instructor_id;

  OPEN p_cur FOR
    SELECT
      i.instructor_id,
      i.person_id,
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
      p.active       AS person_active,
      i.active       AS instructor_active,
      i.linkedin,
      i.odoo_user_id,
      i.odoo_partner_id,
      i.registration_date AS instructor_registration_date
    FROM public.instructors i
    JOIN public.persons p ON p.person_id = i.person_id
    LEFT JOIN public."catalog" td ON td.catalog_id = p.cat_type_document
    LEFT JOIN public."catalog" oc ON oc.catalog_id = p.cat_occupation
    LEFT JOIN public."catalog" ps ON ps.catalog_id = p.cat_person_status
    LEFT JOIN public."catalog" co ON co.catalog_id = p.cat_country
    WHERE i.instructor_id = v_instructor_id;
END;
$procedure$
