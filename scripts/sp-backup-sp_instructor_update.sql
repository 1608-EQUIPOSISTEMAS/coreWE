CREATE OR REPLACE PROCEDURE public.sp_instructor_update(IN p_instructor_id integer, IN p_instructor jsonb, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
  v_person_id          int;
  v_person_active      bpchar(1);
  v_instructor_active  bpchar(1);
  v_user_mod           int;
  
  -- Variables para financieros
  v_financial_item     jsonb;
  v_financial_id_input int;
  v_current_fin_id     int;
  v_attachment_url     text; 

  -- Variables para programas
  v_program_item       jsonb;
  v_prog_id_input      int;
  
BEGIN
  IF p_cur IS NULL THEN
    p_cur := 'cur_sp_instructor_update';
  END IF;

  -- Obtener person_id
  SELECT person_id
  INTO v_person_id
  FROM public.instructors
  WHERE instructor_id = p_instructor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Instructor % no existe', p_instructor_id
      USING ERRCODE = '22023';
  END IF;

  v_user_mod          := NULLIF(p_instructor->>'user_modification_id','')::int;
  v_person_active     := NULLIF(p_instructor->>'person_active','')::bpchar;
  v_instructor_active := NULLIF(p_instructor->>'instructor_active','')::bpchar;
  -- 1. UPDATE persons
  UPDATE public.persons p
  SET
    first_name        = COALESCE(NULLIF(p_instructor->>'first_name',''), p.first_name),
    last_name         = COALESCE(NULLIF(p_instructor->>'last_name',''), p.last_name),
    mother_last_name  = COALESCE(p_instructor->>'mother_last_name', p.mother_last_name),
    document_number   = COALESCE(NULLIF(p_instructor->>'document_number',''), p.document_number),
    cat_occupation    = COALESCE(NULLIF(p_instructor->>'cat_occupation','')::int, p.cat_occupation),
    cat_type_document = COALESCE(NULLIF(p_instructor->>'cat_type_document','')::int, p.cat_type_document),
    cat_person_status = COALESCE(NULLIF(p_instructor->>'cat_person_status','')::int, p.cat_person_status),
    cat_country       = COALESCE(NULLIF(p_instructor->>'cat_country','')::int, p.cat_country),
    birthday          = COALESCE(NULLIF(p_instructor->>'birthday','')::date, p.birthday),
    active            = COALESCE(v_person_active, p.active),
    user_modification_id = COALESCE(v_user_mod, p.user_modification_id),
    modification_date    = NOW()
  WHERE p.person_id = v_person_id;

-- 📧 LOGICA PARA EMAIL (2319)
    -- Solo procesamos si el email no es nulo y no está vacío
    IF (p_instructor->>'email') IS NOT NULL AND (p_instructor->>'email') <> '' THEN
        
        -- 1. Intentamos actualizar
        UPDATE person_contacts 
        SET value = (p_instructor->>'email')
        WHERE person_id = v_person_id 
          AND cat_way_contact = 2319;

        -- 2. Si el update no afectó ninguna fila (no existe el registro), insertamos
        IF NOT FOUND THEN
            INSERT INTO person_contacts (person_id, cat_way_contact, value)
            VALUES (v_person_id, 2319, (p_instructor->>'email'));
        END IF;

    END IF;


    -- 📞 LOGICA PARA TELEFONO (2318)
    IF (p_instructor->>'phone') IS NOT NULL AND (p_instructor->>'phone') <> '' THEN
        
        UPDATE person_contacts 
        SET value = (p_instructor->>'phone')
        WHERE person_id = v_person_id 
          AND cat_way_contact = 2318;

        IF NOT FOUND THEN
            INSERT INTO person_contacts (person_id, cat_way_contact, value)
            VALUES (v_person_id, 2318, (p_instructor->>'phone'));
        END IF;

    END IF;

  -- 2. UPDATE instructors
  UPDATE public.instructors i
  SET
    active               = COALESCE(v_instructor_active, i.active),
    user_modification_id = COALESCE(v_user_mod, i.user_modification_id),
    linkedin             = COALESCE(NULLIF(p_instructor->>'linkedin',''), i.linkedin),
    cv_documents_url     = COALESCE(NULLIF(p_instructor->>'cv_documents_url',''), i.cv_documents_url),
    cv_url               = COALESCE(NULLIF(p_instructor->>'cv_url',''), i.cv_url),
    relevant_company     = COALESCE(NULLIF(p_instructor->>'relevant_company',''), i.relevant_company),
    profile_resume     = COALESCE(NULLIF(p_instructor->>'profile_resume',''), i.profile_resume),
    relevant_work        = COALESCE(NULLIF(p_instructor->>'relevant_work',''), i.relevant_work),
    modification_date    = NOW()
  WHERE i.instructor_id = p_instructor_id;

  -- 3. UPDATE OR INSERT PROGRAMS
  IF p_instructor ? 'programs' AND jsonb_typeof(p_instructor->'programs') = 'array' THEN
      FOR v_program_item IN SELECT * FROM jsonb_array_elements(p_instructor->'programs')
      LOOP
          v_prog_id_input := (NULLIF(v_program_item->>'instructor_program_id', ''))::int;

          IF v_prog_id_input IS NOT NULL THEN
              UPDATE public.instructor_programs ip
              SET 
                  program_id          = COALESCE((NULLIF(v_program_item->>'program_id', ''))::int, ip.program_id),
                  profile_summary     = COALESCE(NULLIF(v_program_item->>'profile_summary', ''), ip.profile_summary),
                  active              = COALESCE(NULLIF(v_program_item->>'active', '')::bpchar, ip.active),
                  user_modification_id= v_user_mod,
                  modification_date   = NOW()
              WHERE ip.instructor_program_id = v_prog_id_input;
          ELSE
              IF (v_program_item->>'program_id') IS NOT NULL THEN
                  INSERT INTO public.instructor_programs (
                      instructor_id,
                      program_id,
                      profile_summary,
                      active,
                      user_registration_id,
                      registration_date
                  ) VALUES (
                      p_instructor_id,
                      (v_program_item->>'program_id')::int,
                      NULLIF(v_program_item->>'profile_summary', ''),
                      COALESCE(NULLIF(v_program_item->>'active', '')::bpchar, 'Y'),
                      v_user_mod,
                      NOW()
                  );
              END IF;
          END IF;
      END LOOP;
  END IF;

  -- -----------------------------------------------------------------------
  -- 4. UPDATE OR INSERT FINANCIALS (ACTUALIZADO A NUEVA TABLA)
  -- -----------------------------------------------------------------------
  IF p_instructor ? 'financials' AND jsonb_typeof(p_instructor->'financials') = 'array' THEN
      
      FOR v_financial_item IN SELECT * FROM jsonb_array_elements(p_instructor->'financials')
      LOOP
          v_financial_id_input := (NULLIF(v_financial_item->>'instructor_financial_id', ''))::int;

          IF v_financial_id_input IS NOT NULL THEN
              -- A) UPDATE
              UPDATE public.instructor_financials f
              SET 
                  bank_name        = COALESCE(NULLIF(v_financial_item->>'bank_name', ''), f.bank_name),
                  cat_payment_type = COALESCE((NULLIF(v_financial_item->>'cat_payment_type', ''))::int, f.cat_payment_type),
                  cat_currency     = COALESCE((NULLIF(v_financial_item->>'cat_currency', ''))::int, f.cat_currency),
                  cat_rate_pay_id  = COALESCE((NULLIF(v_financial_item->>'cat_rate_pay_id', ''))::int, f.cat_rate_pay_id), -- Nuevo campo
                  observations     = COALESCE((NULLIF(v_financial_item->>'observations', '')), f.observations),
                  updated_at       = NOW() -- Nuevo campo timestamp
              WHERE f.instructor_financial_id = v_financial_id_input;

              v_current_fin_id := v_financial_id_input;

          ELSE
              -- B) INSERT
              INSERT INTO public.instructor_financials (
                  instructor_id,
                  bank_name,
                  cat_payment_type,
                  cat_currency,
                  cat_rate_pay_id, -- Nuevo campo
                  observations,
                  active,
                  created_at
              ) VALUES (
                  p_instructor_id,
                  NULLIF(v_financial_item->>'bank_name', ''),
                  (NULLIF(v_financial_item->>'cat_payment_type', ''))::int,
                  (NULLIF(v_financial_item->>'cat_currency', ''))::int,
                  (NULLIF(v_financial_item->>'cat_rate_pay_id', ''))::int,
                  (NULLIF(v_financial_item->>'observations', '')),
                  'Y',
                  NOW()
              )
              RETURNING instructor_financial_id INTO v_current_fin_id;

          END IF;

          -- Manejo de Attachments (Igual que antes)
          IF v_financial_item ? 'attachments' AND jsonb_typeof(v_financial_item->'attachments') = 'array' THEN
			  DELETE from  public.instructor_financial_attachments where instructor_financial_id = v_current_fin_id;
              FOR v_attachment_url IN SELECT * FROM jsonb_array_elements_text(v_financial_item->'attachments')
              LOOP
                  IF v_attachment_url IS NOT NULL AND v_attachment_url <> '' THEN
                      INSERT INTO public.instructor_financial_attachments (
                          instructor_financial_id,
                          document_url,
                          active
                      ) VALUES (
                          v_current_fin_id,
                          v_attachment_url,
                          'Y'
                      );
                  END IF;
              END LOOP;
          END IF; 

      END LOOP;
  END IF;

  -- Salida del Cursor (Igual al anterior pero actualizado)
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
      p.active        AS person_active,
      i.active        AS instructor_active,
      i.relevant_company,
      i.relevant_work,
      i.linkedin,
      i.cv_url,
      p.user_registration_id AS person_user_registration_id,
      p.user_modification_id AS person_user_modification_id,
      p.registration_date    AS person_registration_date,
      p.modification_date    AS person_modification_date,
      i.user_registration_id AS instructor_user_registration_id,
      i.user_modification_id AS instructor_user_modification_id,
      i.registration_date    AS instructor_registration_date,
      i.modification_date    AS instructor_modification_date
    FROM public.instructors i
    JOIN public.persons p ON p.person_id = i.person_id
    LEFT JOIN public."catalog" td ON td.catalog_id = p.cat_type_document
    LEFT JOIN public."catalog" oc ON oc.catalog_id = p.cat_occupation
    LEFT JOIN public."catalog" ps ON ps.catalog_id = p.cat_person_status
    LEFT JOIN public."catalog" co ON co.catalog_id = p.cat_country
    WHERE i.instructor_id = p_instructor_id;
END;
$procedure$
