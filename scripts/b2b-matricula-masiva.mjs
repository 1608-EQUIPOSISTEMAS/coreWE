// Envio masivo de los cupos de un contrato B2B a FICO.
//
// Un contrato corporativo se vende una vez y reparte N cupos. Cada cupo se
// convierte en un enrollment de MONTO 0 colgado del contrato
// (enrollments.b2b_contract_id): la plata vive en el contrato, contar 10 ventas
// duplicaria el ingreso. Por eso nacen igual que los hijos de un paquete
// (SEG + al contado + certificado incluido), la convencion que ya usa
// validation.repository.insertChildEnrollment.
//
// El corte nombres/apellidos NO se adivina: los beneficiarios migrados de la
// hoja traen las dos convenciones mezcladas ("CURO RAMOS FRANCISCO" y
// "FRANCISCO CURO RAMOS") y sin documento. Como fn_person_resolve empareja por
// nombre+apellido+correo cuando no hay DNI, un corte al reves crea una persona
// duplicada y manda el certificado de Odoo con el nombre invertido. El asesor
// llena first_name / last_name y el SP se niega a matricular sin ellos.
//
// Idempotente: se puede correr las veces que haga falta.
import { pool } from './db.mjs'

const COLUMNAS = `
  ALTER TABLE public.b2b_contract_beneficiaries
    ADD COLUMN IF NOT EXISTS first_name varchar(150),
    ADD COLUMN IF NOT EXISTS last_name  varchar(150);
`

const SP_MATRICULA = `
CREATE OR REPLACE PROCEDURE public.sp_b2b_contract_enroll_beneficiaries(
  IN p_contract_id integer, IN p_user_id integer, INOUT p_result refcursor)
LANGUAGE plpgsql AS $$
DECLARE
  b               record;
  v_person_id     int;
  v_customer_id   int;
  v_enrollment_id int;
  v_programa      text;
  c_dni     int := (SELECT catalog_id FROM public."catalog" WHERE alias = 'we_type_document_dni');
  c_seg     int := (SELECT catalog_id FROM public."catalog" WHERE alias = 'we_enrollment_status_tracking');
  c_ok      int := (SELECT catalog_id FROM public."catalog" WHERE alias = 'we_enrollment_status_checked');
  c_cert    int := (SELECT catalog_id FROM public."catalog" WHERE alias = 'we_certificate_status_paid');
  c_contado int := (SELECT catalog_id FROM public."catalog" WHERE alias = 'we_payment_way_single');
  c_modal   int := (SELECT catalog_id FROM public."catalog" WHERE alias = 'we_insc_modality_normal');
  c_canal   int := (SELECT catalog_id FROM public."catalog" WHERE alias = 'we_channel_general');
  c_perfil  int := (SELECT catalog_id FROM public."catalog" WHERE alias = 'we_profile_professional');
  c_email   int := (SELECT catalog_id FROM public."catalog" WHERE alias = 'we_way_contact_email');
  c_phone   int := (SELECT catalog_id FROM public."catalog" WHERE alias = 'we_way_contact_phone');
BEGIN
  CREATE TEMP TABLE tmp_b2b_matricula (
    beneficiary_id int, full_name text, enrollment_id int, estado text, mensaje text
  ) ON COMMIT DROP;

  FOR b IN
    SELECT bb.*, bc.cat_currency, bc.company_id
      FROM public.b2b_contract_beneficiaries bb
      JOIN public.b2b_contracts bc ON bc.b2b_contract_id = bb.b2b_contract_id
     WHERE bb.b2b_contract_id = p_contract_id AND bb.active = 'Y'
     ORDER BY bb.beneficiary_id
  LOOP
    -- Ya matriculado: correr dos veces no duplica la inscripcion.
    IF b.enrollment_id IS NOT NULL THEN
      INSERT INTO tmp_b2b_matricula VALUES (b.beneficiary_id, b.full_name, b.enrollment_id,
        'ya_matriculado', 'Ya tenia inscripcion');
      CONTINUE;
    END IF;

    IF b.program_version_id IS NULL THEN
      INSERT INTO tmp_b2b_matricula VALUES (b.beneficiary_id, b.full_name, NULL,
        'sin_programa', 'Falta elegir el curso del cupo');
      CONTINUE;
    END IF;

    IF NULLIF(trim(COALESCE(b.first_name, '')), '') IS NULL
       OR NULLIF(trim(COALESCE(b.last_name, '')), '') IS NULL THEN
      INSERT INTO tmp_b2b_matricula VALUES (b.beneficiary_id, b.full_name, NULL,
        'sin_nombres', 'Faltan nombres y apellidos separados');
      CONTINUE;
    END IF;

    -- Sin documento NI correo no hay como reconocer a la persona: fn_person_resolve
    -- crearia una nueva en cada corrida y el alumno nunca recibiria el aula.
    IF NULLIF(trim(COALESCE(b.document_number, '')), '') IS NULL
       AND NULLIF(trim(COALESCE(b.email, '')), '') IS NULL THEN
      INSERT INTO tmp_b2b_matricula VALUES (b.beneficiary_id, b.full_name, NULL,
        'sin_identidad', 'Falta documento o correo');
      CONTINUE;
    END IF;

    BEGIN
      -- 1. Persona por la regla unica de identidad (adopta el DNI si llega tarde).
      v_person_id := public.fn_person_resolve(
        NULLIF(trim(COALESCE(b.document_number, '')), ''), c_dni,
        trim(b.first_name), trim(b.last_name),
        split_part(trim(COALESCE(b.email, '')), ' ', 1), p_user_id);

      -- 2. Cliente.
      SELECT customer_id INTO v_customer_id
        FROM public.customers WHERE person_id = v_person_id ORDER BY customer_id LIMIT 1;
      IF v_customer_id IS NULL THEN
        INSERT INTO public.customers (person_id, active, user_registration_id)
        VALUES (v_person_id, 'Y', p_user_id) RETURNING customer_id INTO v_customer_id;
      END IF;

      -- 3. Contactos. El correo puede venir con dos direcciones en la misma
      --    celda ("uno@x.pe dos@y.com"): se guarda la primera, que es la de trabajo.
      IF NULLIF(trim(COALESCE(b.email, '')), '') IS NOT NULL THEN
        INSERT INTO public.person_contacts (person_id, cat_way_contact, value, active, registration_date, user_registration_id)
        SELECT v_person_id, c_email, split_part(trim(b.email), ' ', 1), 'Y', now(), p_user_id
         WHERE NOT EXISTS (
           SELECT 1 FROM public.person_contacts
            WHERE person_id = v_person_id AND cat_way_contact = c_email
              AND lower(trim(value)) = lower(split_part(trim(b.email), ' ', 1)));
      END IF;
      IF NULLIF(trim(COALESCE(b.phone, '')), '') IS NOT NULL THEN
        INSERT INTO public.person_contacts (person_id, cat_way_contact, value, active, registration_date, user_registration_id)
        SELECT v_person_id, c_phone, trim(b.phone), 'Y', now(), p_user_id
         WHERE NOT EXISTS (
           SELECT 1 FROM public.person_contacts
            WHERE person_id = v_person_id AND cat_way_contact = c_phone AND trim(value) = trim(b.phone));
      END IF;

      -- 4. Inscripcion de monto 0 colgada del contrato.
      SELECT program_name INTO v_programa FROM public.programs WHERE program_id = b.program_version_id;

      INSERT INTO public.enrollments (
        customer_id, program_version_id, program_edition_id, b2b_contract_id,
        total_amount, discount_amount, list_price,
        cat_currency, cat_inscription_modality, cat_payment_channel, cat_payment_plan,
        cat_fico_status, cat_type_status, cat_certificate_status, cat_profile_id,
        agent_origin, active, user_registration_id, registration_date, notes)
      VALUES (
        v_customer_id, b.program_version_id, b.edition_id, p_contract_id,
        0, 0, 0,
        COALESCE(b.cat_currency, (SELECT catalog_id FROM public."catalog" WHERE alias = 'we_currency_soles')),
        c_modal, c_canal, c_contado,
        c_ok, c_seg, c_cert, c_perfil,
        'B2B', 'Y', p_user_id, now(),
        format('Cupo B2B del contrato #%s%s', p_contract_id,
               COALESCE(' - ' || v_programa, '')))
      RETURNING enrollment_id INTO v_enrollment_id;

      UPDATE public.b2b_contract_beneficiaries
         SET person_id = v_person_id, enrollment_id = v_enrollment_id, modification_date = now()
       WHERE beneficiary_id = b.beneficiary_id;

      INSERT INTO tmp_b2b_matricula VALUES (b.beneficiary_id, b.full_name, v_enrollment_id,
        'creado', COALESCE(v_programa, 'Inscrito'));
    EXCEPTION WHEN OTHERS THEN
      -- El fallo de un cupo no puede tumbar a los otros nueve, pero SI se reporta:
      -- un error mudo aqui deja al alumno fuera del aula sin que nadie se entere.
      INSERT INTO tmp_b2b_matricula VALUES (b.beneficiary_id, b.full_name, NULL,
        'error', SQLERRM);
    END;
  END LOOP;

  OPEN p_result FOR SELECT * FROM tmp_b2b_matricula ORDER BY beneficiary_id;
END;
$$;
`

const cliente = await pool.connect()
try {
  await cliente.query('BEGIN')
  await cliente.query(COLUMNAS)
  await cliente.query(SP_MATRICULA)
  await cliente.query('COMMIT')
  console.log('✓ b2b_contract_beneficiaries: first_name / last_name')
  console.log('✓ sp_b2b_contract_enroll_beneficiaries')
} catch (err) {
  await cliente.query('ROLLBACK')
  throw err
} finally {
  cliente.release()
  await pool.end()
}
