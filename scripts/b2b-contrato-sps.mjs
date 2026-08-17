// SPs de contrato B2B con plata, descuentos de convenio y reparto de cupos.
//
// Ojo con el shape del payload: el frontend manda { contract: {...}, discounts,
// beneficiaries } pero los SPs viejos leian las claves en la raiz (p_data->>'company_id'),
// asi que TODO llegaba NULL y el INSERT moria por company_id NOT NULL. Aqui se
// acepta cualquiera de las dos formas con COALESCE(p_data->'contract', p_data).
//
// Descuentos y beneficiarios se reemplazan enteros cuando la clave viene en el
// payload, y se dejan intactos cuando no viene: "no mandado" != "borrame".
import { pool } from './db.mjs'

const CAMPOS_CONTRATO = `
  company_id, cat_contract_type, contract_name, description,
  contract_date, start_date, end_date,
  cat_client_type, cat_modality, cat_currency, cat_payment_terms,
  program_version_id, number_of_licenses, cat_type_status, lead_id,
  total_amount, paid_amount, paid_amount_pen,
  consultation_date, close_date, payment_date, confirmation_sent_date, invoice_date,
  country, purchase_order_url, notes, legacy_sheet`

const SPS = [
  ['sp_b2b_contract_register', `
    CREATE OR REPLACE PROCEDURE public.sp_b2b_contract_register(IN p_data jsonb, OUT result integer, OUT message text, OUT contract_id integer)
    LANGUAGE plpgsql AS $$
    DECLARE
      c       jsonb := COALESCE(p_data->'contract', p_data);
      v_id    int;
    BEGIN
      IF (c->>'company_id') IS NULL THEN
        result := 0; message := 'Falta la empresa del contrato'; RETURN;
      END IF;

      INSERT INTO public.b2b_contracts (${CAMPOS_CONTRATO}, user_registration_id, registration_date, active)
      VALUES (
        (c->>'company_id')::int,
        (c->>'cat_contract_type')::int,
        c->>'contract_name',
        c->>'description',
        COALESCE((c->>'contract_date')::date, (c->>'start_date')::date, CURRENT_DATE),
        (c->>'start_date')::date,
        (c->>'end_date')::date,
        (c->>'cat_client_type')::int,
        (c->>'cat_modality')::int,
        (c->>'cat_currency')::int,
        (c->>'cat_payment_terms')::int,
        (c->>'program_version_id')::int,
        (c->>'number_of_licenses')::int,
        (c->>'cat_type_status')::int,
        (c->>'lead_id')::int,
        (c->>'total_amount')::numeric,
        (c->>'paid_amount')::numeric,
        (c->>'paid_amount_pen')::numeric,
        (c->>'consultation_date')::date,
        (c->>'close_date')::date,
        (c->>'payment_date')::date,
        (c->>'confirmation_sent_date')::date,
        (c->>'invoice_date')::date,
        c->>'country',
        c->>'purchase_order_url',
        c->>'notes',
        c->'legacy_sheet',
        (c->>'user_registration_id')::int,
        now(),
        COALESCE(c->>'active', 'Y')
      )
      RETURNING b2b_contract_id INTO v_id;

      CALL public.sp_b2b_contract_children_sync(v_id, p_data);

      result := 1; message := 'Contrato registrado correctamente'; contract_id := v_id;
    EXCEPTION WHEN OTHERS THEN
      result := 0; message := SQLERRM; contract_id := NULL;
    END;
    $$;
  `],

  // Hijos (descuentos y beneficiarios) en un solo lugar: register y update
  // hacian lo mismo copiado dos veces.
  ['sp_b2b_contract_children_sync', `
    CREATE OR REPLACE PROCEDURE public.sp_b2b_contract_children_sync(IN p_contract_id integer, IN p_data jsonb)
    LANGUAGE plpgsql AS $$
    BEGIN
      IF p_data ? 'discounts' THEN
        DELETE FROM public.agreement_discounts WHERE b2b_contract_id = p_contract_id;
        INSERT INTO public.agreement_discounts (b2b_contract_id, cat_type_program, cat_model_modality, discount_pct)
        SELECT p_contract_id,
               NULLIF(d->>'cat_type_program', '')::int,
               NULLIF(d->>'cat_model_modality', '')::int,
               (d->>'discount_pct')::numeric
          FROM jsonb_array_elements(COALESCE(p_data->'discounts', '[]'::jsonb)) d
         WHERE (d->>'discount_pct') IS NOT NULL;
      END IF;

      IF p_data ? 'beneficiaries' THEN
        -- Baja logica, no DELETE: un beneficiario ya inscrito tiene enrollment_id
        -- y borrarlo dejaria la inscripcion huerfana del contrato que la pago.
        UPDATE public.b2b_contract_beneficiaries
           SET active = 'N', modification_date = now()
         WHERE b2b_contract_id = p_contract_id
           AND active = 'Y'
           AND beneficiary_id NOT IN (
             SELECT NULLIF(b->>'beneficiary_id', '')::int
               FROM jsonb_array_elements(COALESCE(p_data->'beneficiaries', '[]'::jsonb)) b
              WHERE NULLIF(b->>'beneficiary_id', '') IS NOT NULL);

        INSERT INTO public.b2b_contract_beneficiaries AS bb (
          beneficiary_id, b2b_contract_id, full_name, first_name, last_name,
          document_number, email, phone,
          program_version_id, edition_id, notes, active, registration_date)
        SELECT COALESCE(NULLIF(b->>'beneficiary_id', '')::int, nextval('b2b_contract_beneficiaries_beneficiary_id_seq')::int),
               p_contract_id,
               b->>'full_name',
               NULLIF(trim(b->>'first_name'), ''),
               NULLIF(trim(b->>'last_name'), ''),
               NULLIF(b->>'document_number', ''),
               NULLIF(b->>'email', ''),
               NULLIF(b->>'phone', ''),
               NULLIF(b->>'program_version_id', '')::int,
               NULLIF(b->>'edition_id', '')::int,
               NULLIF(b->>'notes', ''),
               'Y', now()
          FROM jsonb_array_elements(COALESCE(p_data->'beneficiaries', '[]'::jsonb)) b
         WHERE NULLIF(trim(b->>'full_name'), '') IS NOT NULL
        ON CONFLICT (beneficiary_id) DO UPDATE SET
          full_name          = EXCLUDED.full_name,
          first_name         = EXCLUDED.first_name,
          last_name          = EXCLUDED.last_name,
          document_number    = EXCLUDED.document_number,
          email              = EXCLUDED.email,
          phone              = EXCLUDED.phone,
          program_version_id = EXCLUDED.program_version_id,
          edition_id         = EXCLUDED.edition_id,
          notes              = EXCLUDED.notes,
          active             = 'Y',
          modification_date  = now();

        PERFORM setval('b2b_contract_beneficiaries_beneficiary_id_seq',
                       GREATEST((SELECT COALESCE(MAX(beneficiary_id), 0) FROM public.b2b_contract_beneficiaries), 1));
      END IF;
    END;
    $$;
  `],

  ['sp_b2b_contract_update', `
    CREATE OR REPLACE PROCEDURE public.sp_b2b_contract_update(IN p_contract_id integer, IN p_data jsonb, OUT result integer, OUT message text)
    LANGUAGE plpgsql AS $$
    DECLARE c jsonb := COALESCE(p_data->'contract', p_data);
    BEGIN
      -- "clave presente" manda, incluso con null: asi se puede vaciar una fecha
      -- o un monto. COALESCE a secas haria imposible borrar un dato cargado mal.
      UPDATE public.b2b_contracts SET
        company_id             = CASE WHEN c ? 'company_id'             THEN (c->>'company_id')::int             ELSE company_id             END,
        cat_contract_type      = CASE WHEN c ? 'cat_contract_type'      THEN (c->>'cat_contract_type')::int      ELSE cat_contract_type      END,
        contract_name          = CASE WHEN c ? 'contract_name'          THEN c->>'contract_name'                 ELSE contract_name          END,
        description            = CASE WHEN c ? 'description'            THEN c->>'description'                   ELSE description            END,
        contract_date          = CASE WHEN c ? 'contract_date'          THEN (c->>'contract_date')::date         ELSE contract_date          END,
        start_date             = CASE WHEN c ? 'start_date'             THEN (c->>'start_date')::date            ELSE start_date             END,
        end_date               = CASE WHEN c ? 'end_date'               THEN (c->>'end_date')::date              ELSE end_date               END,
        cat_client_type        = CASE WHEN c ? 'cat_client_type'        THEN (c->>'cat_client_type')::int        ELSE cat_client_type        END,
        cat_modality           = CASE WHEN c ? 'cat_modality'           THEN (c->>'cat_modality')::int           ELSE cat_modality           END,
        cat_currency           = CASE WHEN c ? 'cat_currency'           THEN (c->>'cat_currency')::int           ELSE cat_currency           END,
        cat_payment_terms      = CASE WHEN c ? 'cat_payment_terms'      THEN (c->>'cat_payment_terms')::int      ELSE cat_payment_terms      END,
        program_version_id     = CASE WHEN c ? 'program_version_id'     THEN (c->>'program_version_id')::int     ELSE program_version_id     END,
        number_of_licenses     = CASE WHEN c ? 'number_of_licenses'     THEN (c->>'number_of_licenses')::int     ELSE number_of_licenses     END,
        cat_type_status        = CASE WHEN c ? 'cat_type_status'        THEN (c->>'cat_type_status')::int        ELSE cat_type_status        END,
        total_amount           = CASE WHEN c ? 'total_amount'           THEN (c->>'total_amount')::numeric       ELSE total_amount           END,
        paid_amount            = CASE WHEN c ? 'paid_amount'            THEN (c->>'paid_amount')::numeric        ELSE paid_amount            END,
        paid_amount_pen        = CASE WHEN c ? 'paid_amount_pen'        THEN (c->>'paid_amount_pen')::numeric    ELSE paid_amount_pen        END,
        consultation_date      = CASE WHEN c ? 'consultation_date'      THEN (c->>'consultation_date')::date     ELSE consultation_date      END,
        close_date             = CASE WHEN c ? 'close_date'             THEN (c->>'close_date')::date            ELSE close_date             END,
        payment_date           = CASE WHEN c ? 'payment_date'           THEN (c->>'payment_date')::date          ELSE payment_date           END,
        confirmation_sent_date = CASE WHEN c ? 'confirmation_sent_date' THEN (c->>'confirmation_sent_date')::date ELSE confirmation_sent_date END,
        invoice_date           = CASE WHEN c ? 'invoice_date'           THEN (c->>'invoice_date')::date          ELSE invoice_date           END,
        country                = CASE WHEN c ? 'country'                THEN c->>'country'                       ELSE country                END,
        purchase_order_url     = CASE WHEN c ? 'purchase_order_url'     THEN c->>'purchase_order_url'            ELSE purchase_order_url     END,
        notes                  = CASE WHEN c ? 'notes'                  THEN c->>'notes'                         ELSE notes                  END,
        active                 = COALESCE(c->>'active', active),
        user_modification_id   = COALESCE((c->>'user_modification_id')::int, user_modification_id),
        modification_date      = now()
      WHERE b2b_contract_id = p_contract_id;

      IF NOT FOUND THEN
        result := 0; message := 'No existe el contrato '||p_contract_id; RETURN;
      END IF;

      CALL public.sp_b2b_contract_children_sync(p_contract_id, p_data);

      result := 1; message := 'Contrato actualizado correctamente';
    EXCEPTION WHEN OTHERS THEN
      result := 0; message := SQLERRM;
    END;
    $$;
  `],

  ['sp_b2b_contract_get', `
    CREATE OR REPLACE PROCEDURE public.sp_b2b_contract_get(IN p_contract_id integer, INOUT p_result refcursor)
    LANGUAGE plpgsql AS $$
    BEGIN
      OPEN p_result FOR
        SELECT
          bc.*,
          bc.b2b_contract_id                AS contract_id,
          c.razon_social                    AS company_name,
          c.document_number,
          tipo.description                  AS contract_type_label,
          tipo.alias                        AS contract_type_alias,
          moneda.alias                      AS currency_alias,
          CASE WHEN bc.active = 'N' THEN 'cancelled'
               WHEN bc.end_date < CURRENT_DATE THEN 'expired'
               ELSE 'active' END            AS status,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                     'discount_id',        d.discount_id,
                     'cat_type_program',   d.cat_type_program,
                     'cat_model_modality', d.cat_model_modality,
                     'discount_pct',       d.discount_pct) ORDER BY d.discount_id)
              FROM public.agreement_discounts d
             WHERE d.b2b_contract_id = bc.b2b_contract_id
          ), '[]'::jsonb)                   AS discounts,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                     'beneficiary_id',     b.beneficiary_id,
                     'full_name',          b.full_name,
                     'first_name',         b.first_name,
                     'last_name',          b.last_name,
                     'document_number',    b.document_number,
                     'email',              b.email,
                     'phone',              b.phone,
                     'program_version_id', b.program_version_id,
                     'program_label',      pv.program_name,
                     'edition_id',         b.edition_id,
                     'enrollment_id',      b.enrollment_id,
                     'notes',              b.notes) ORDER BY b.beneficiary_id)
              FROM public.b2b_contract_beneficiaries b
              LEFT JOIN public.programs pv ON pv.program_id = b.program_version_id
             WHERE b.b2b_contract_id = bc.b2b_contract_id AND b.active = 'Y'
          ), '[]'::jsonb)                   AS beneficiaries
        FROM public.b2b_contracts bc
        JOIN public.companies c    ON c.company_id   = bc.company_id
        JOIN public.catalog   tipo ON tipo.catalog_id = bc.cat_contract_type
        LEFT JOIN public.catalog moneda ON moneda.catalog_id = bc.cat_currency
        WHERE bc.b2b_contract_id = p_contract_id;
    END;
    $$;
  `],

  ['sp_b2b_contract_list', `
    CREATE OR REPLACE PROCEDURE public.sp_b2b_contract_list(IN p_filters jsonb, INOUT p_result refcursor)
    LANGUAGE plpgsql AS $$
    DECLARE
      v_company    int  := (p_filters->>'company_id')::int;
      v_tipo       int  := (p_filters->>'cat_contract_type')::int;
      v_estado     text := p_filters->>'status';
      v_q          text := NULLIF(trim(p_filters->>'q'), '');
      v_desde      date := (p_filters->>'from_date')::date;
      v_hasta      date := (p_filters->>'to_date')::date;
      v_page       int  := COALESCE((p_filters->>'page')::int, 1);
      v_size       int  := COALESCE((p_filters->>'size')::int, 25);
    BEGIN
      OPEN p_result FOR
        WITH cupos AS (
          SELECT b2b_contract_id,
                 COUNT(*) FILTER (WHERE active = 'Y')                              AS asignados,
                 COUNT(*) FILTER (WHERE active = 'Y' AND enrollment_id IS NOT NULL) AS matriculados
            FROM public.b2b_contract_beneficiaries
           GROUP BY b2b_contract_id
        )
        SELECT
          bc.*,
          bc.b2b_contract_id        AS contract_id,
          c.razon_social            AS company_name,
          c.document_number,
          tipo.description          AS contract_type_label,
          tipo.alias                AS contract_type_alias,
          cliente.description       AS client_type_label,
          moneda.description        AS currency_label,
          moneda.alias              AS currency_alias,
          COALESCE(cu.asignados, 0)    AS seats_assigned,
          COALESCE(cu.matriculados, 0) AS seats_enrolled,
          -- Cupos libres: lo que se vendio menos lo ya repartido. Negativo = se
          -- entregaron mas cupos de los comprados, y hay que verlo en pantalla.
          COALESCE(bc.number_of_licenses, 0) - COALESCE(cu.asignados, 0) AS seats_available,
          COALESCE(bc.total_amount, 0) - COALESCE(bc.paid_amount, 0)     AS pending_amount,
          CASE WHEN bc.active = 'N' THEN 'cancelled'
               WHEN bc.end_date < CURRENT_DATE THEN 'expired'
               ELSE 'active' END  AS status,
          COUNT(*) OVER()         AS total_count
        FROM public.b2b_contracts bc
        JOIN public.companies c      ON c.company_id    = bc.company_id
        JOIN public.catalog   tipo   ON tipo.catalog_id = bc.cat_contract_type
        LEFT JOIN public.catalog cliente ON cliente.catalog_id = bc.cat_client_type
        LEFT JOIN public.catalog moneda  ON moneda.catalog_id  = bc.cat_currency
        LEFT JOIN cupos cu ON cu.b2b_contract_id = bc.b2b_contract_id
        WHERE (v_company IS NULL OR bc.company_id        = v_company)
          AND (v_tipo    IS NULL OR bc.cat_contract_type = v_tipo)
          AND (v_desde   IS NULL OR bc.contract_date    >= v_desde)
          AND (v_hasta   IS NULL OR bc.contract_date    <= v_hasta)
          AND (v_q IS NULL OR c.razon_social ILIKE '%'||v_q||'%'
                           OR c.document_number ILIKE '%'||v_q||'%'
                           OR bc.contract_name ILIKE '%'||v_q||'%')
          AND (v_estado IS NULL OR
               CASE WHEN bc.active = 'N' THEN 'cancelled'
                    WHEN bc.end_date < CURRENT_DATE THEN 'expired'
                    ELSE 'active' END = v_estado)
        ORDER BY bc.contract_date DESC NULLS LAST, bc.b2b_contract_id DESC
        LIMIT v_size OFFSET (v_page - 1) * v_size;
    END;
    $$;
  `],
]

const cliente = await pool.connect()
try {
  for (const [nombre, sql] of SPS) {
    await cliente.query(sql)
    console.log(`✓ ${nombre}`)
  }
} finally {
  cliente.release()
  await pool.end()
}
