// Repara el dominio B2B en produccion. Dos roturas encontradas el 2026-08-17:
//
//   1. sp_b2b_company_get / _register leen y escriben company_contacts y
//      company_affiliates, que NUNCA se crearon. Editar o crear una empresa con
//      contactos revienta con "relation does not exist".
//   2. Los SPs de contrato usan bc.contract_id, pero la columna real es
//      b2b_contracts.b2b_contract_id. Por eso la tabla tiene 0 filas: cada alta
//      fallaba y el EXCEPTION del SP se tragaba el error como result=0.
//
// Idempotente y en una sola conexion (el tunel se cae seguido). Correr:
//   cd Backend && node scripts/fix-b2b-esquema.mjs
import { pool } from './db.mjs'

const PASOS = [
  ['company_contacts', `
    CREATE TABLE IF NOT EXISTS public.company_contacts (
      contact_id       serial PRIMARY KEY,
      company_id       integer NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
      contact_name     varchar(150) NOT NULL,
      contact_position varchar(120),
      contact_phone    varchar(20),
      contact_email    varchar(120),
      is_primary       boolean NOT NULL DEFAULT false,
      person_id        integer,
      active           character(1) NOT NULL DEFAULT 'Y',
      registration_date timestamp NOT NULL DEFAULT now(),
      modification_date timestamp
    );
    CREATE INDEX IF NOT EXISTS ix_company_contacts_company ON public.company_contacts (company_id) WHERE active = 'Y';
  `],

  ['company_affiliates', `
    CREATE TABLE IF NOT EXISTS public.company_affiliates (
      affiliate_id      serial PRIMARY KEY,
      parent_company_id integer NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
      child_company_id  integer NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
      active            character(1) NOT NULL DEFAULT 'Y',
      registration_date timestamp NOT NULL DEFAULT now(),
      -- El SP hace ON CONFLICT DO NOTHING: sin este unique el vinculo se duplica.
      CONSTRAINT uq_company_affiliates UNIQUE (parent_company_id, child_company_id),
      CONSTRAINT ck_company_affiliates_no_self CHECK (parent_company_id <> child_company_id)
    );
  `],

  ['sp_b2b_contract_get', `
    CREATE OR REPLACE PROCEDURE public.sp_b2b_contract_get(IN p_contract_id integer, OUT p_result refcursor)
    LANGUAGE plpgsql AS $$
    BEGIN
      OPEN p_result FOR
        SELECT
          bc.*,
          bc.b2b_contract_id AS contract_id,
          c.razon_social  AS company_name,
          c.document_number,
          cat.description AS contract_type_label,
          cat.alias       AS contract_type_alias,
          CASE
            WHEN bc.active = 'N'            THEN 'cancelled'
            WHEN bc.end_date < CURRENT_DATE THEN 'expired'
            ELSE 'active'
          END AS status
        FROM public.b2b_contracts bc
        JOIN public.companies c   ON c.company_id   = bc.company_id
        JOIN public.catalog   cat ON cat.catalog_id = bc.cat_contract_type
        WHERE bc.b2b_contract_id = p_contract_id;
    END;
    $$;
  `],

  ['sp_b2b_contract_list', `
    CREATE OR REPLACE PROCEDURE public.sp_b2b_contract_list(IN p_filters jsonb, OUT p_result refcursor)
    LANGUAGE plpgsql AS $$
    DECLARE
      v_company_id    int  := (p_filters->>'company_id')::int;
      v_contract_type int  := (p_filters->>'cat_contract_type')::int;
      v_status        text := p_filters->>'status';
      v_q             text := NULLIF(trim(p_filters->>'q'), '');
      v_page          int  := COALESCE((p_filters->>'page')::int, 1);
      v_size          int  := COALESCE((p_filters->>'size')::int, 25);
    BEGIN
      OPEN p_result FOR
        SELECT
          bc.*,
          bc.b2b_contract_id AS contract_id,
          c.razon_social       AS company_name,
          c.document_number,
          cat.description      AS contract_type_label,
          cat.alias            AS contract_type_alias,
          CASE
            WHEN bc.active = 'N'            THEN 'cancelled'
            WHEN bc.end_date < CURRENT_DATE THEN 'expired'
            ELSE 'active'
          END AS status,
          COUNT(*) OVER() AS total_count
        FROM public.b2b_contracts bc
        JOIN public.companies c   ON c.company_id   = bc.company_id
        JOIN public.catalog   cat ON cat.catalog_id = bc.cat_contract_type
        WHERE (v_company_id    IS NULL OR bc.company_id        = v_company_id)
          AND (v_contract_type IS NULL OR bc.cat_contract_type = v_contract_type)
          AND (v_q IS NULL OR c.razon_social ILIKE '%'||v_q||'%'
                           OR c.document_number ILIKE '%'||v_q||'%'
                           OR bc.contract_name ILIKE '%'||v_q||'%')
          AND (v_status IS NULL OR
               CASE
                 WHEN bc.active = 'N'            THEN 'cancelled'
                 WHEN bc.end_date < CURRENT_DATE THEN 'expired'
                 ELSE 'active'
               END = v_status)
        ORDER BY bc.start_date DESC, bc.b2b_contract_id DESC
        LIMIT v_size OFFSET (v_page - 1) * v_size;
    END;
    $$;
  `],

  ['sp_b2b_contract_register', `
    CREATE OR REPLACE PROCEDURE public.sp_b2b_contract_register(IN p_data jsonb, OUT result integer, OUT message text, OUT contract_id integer)
    LANGUAGE plpgsql AS $$
    DECLARE v_new_id int;
    BEGIN
      INSERT INTO public.b2b_contracts (
        company_id, cat_contract_type, contract_name, description,
        start_date, end_date, contract_date, notes, purchase_order_url,
        total_amount, number_of_licenses, cat_type_status, lead_id,
        user_registration_id, registration_date, active
      ) VALUES (
        (p_data->>'company_id')::int,
        (p_data->>'cat_contract_type')::int,
        p_data->>'contract_name',
        p_data->>'description',
        (p_data->>'start_date')::date,
        (p_data->>'end_date')::date,
        COALESCE((p_data->>'contract_date')::date, (p_data->>'start_date')::date),
        p_data->>'notes',
        p_data->>'purchase_order_url',
        (p_data->>'total_amount')::numeric,
        (p_data->>'number_of_licenses')::int,
        (p_data->>'cat_type_status')::int,
        (p_data->>'lead_id')::int,
        (p_data->>'user_registration_id')::int,
        now(),
        COALESCE(p_data->>'active', 'Y')
      )
      RETURNING b2b_contracts.b2b_contract_id INTO v_new_id;

      result := 1; message := 'Contrato registrado correctamente'; contract_id := v_new_id;
    EXCEPTION WHEN OTHERS THEN
      result := 0; message := SQLERRM; contract_id := NULL;
    END;
    $$;
  `],

  ['sp_b2b_contract_update', `
    CREATE OR REPLACE PROCEDURE public.sp_b2b_contract_update(IN p_contract_id integer, IN p_data jsonb, OUT result integer, OUT message text)
    LANGUAGE plpgsql AS $$
    BEGIN
      -- COALESCE deja "no mandado" == "no cambies". Los nullables que el usuario
      -- SI puede vaciar (end_date, montos) usan la clave presente en el jsonb.
      UPDATE public.b2b_contracts SET
        company_id         = COALESCE((p_data->>'company_id')::int,        company_id),
        cat_contract_type  = COALESCE((p_data->>'cat_contract_type')::int, cat_contract_type),
        contract_name      = COALESCE(p_data->>'contract_name',            contract_name),
        description        = COALESCE(p_data->>'description',              description),
        start_date         = COALESCE((p_data->>'start_date')::date,       start_date),
        end_date           = CASE WHEN p_data ? 'end_date'           THEN (p_data->>'end_date')::date          ELSE end_date           END,
        notes              = COALESCE(p_data->>'notes',                    notes),
        purchase_order_url = COALESCE(p_data->>'purchase_order_url',       purchase_order_url),
        total_amount       = CASE WHEN p_data ? 'total_amount'       THEN (p_data->>'total_amount')::numeric   ELSE total_amount       END,
        number_of_licenses = CASE WHEN p_data ? 'number_of_licenses' THEN (p_data->>'number_of_licenses')::int ELSE number_of_licenses END,
        cat_type_status    = CASE WHEN p_data ? 'cat_type_status'    THEN (p_data->>'cat_type_status')::int    ELSE cat_type_status    END,
        active             = COALESCE(p_data->>'active',                   active),
        user_modification_id = COALESCE((p_data->>'user_modification_id')::int, user_modification_id),
        modification_date  = now()
      WHERE b2b_contract_id = p_contract_id;

      IF NOT FOUND THEN
        result := 0; message := 'No existe el contrato '||p_contract_id; RETURN;
      END IF;
      result := 1; message := 'Contrato actualizado correctamente';
    EXCEPTION WHEN OTHERS THEN
      result := 0; message := SQLERRM;
    END;
    $$;
  `],
]

const cliente = await pool.connect()
try {
  for (const [nombre, sql] of PASOS) {
    await cliente.query(sql)
    console.log(`✓ ${nombre}`)
  }
} finally {
  cliente.release()
  await pool.end()
}
