// Reescribe sp_b2b_company_register y sp_b2b_company_update para leer el payload
// REAL que manda el formulario.
//
// El front (views/b2b/companies/Form.vue) manda { company: {...}, contacts, affiliate_ids }
// y los SPs leian p_data->>'razon_social' en la raiz. En jsonb una clave que no
// existe es NULL, no un error: cada alta insertaba una empresa razon_social NULL /
// document_number NULL, el SP contestaba result=1 y la pantalla decia "creada".
// De ahi salieron las filas 1146..1148 y 1151..1152 en produccion.
//
// De paso se guardan razon_comercial, cat_sector y cat_classification, que el
// formulario pide desde 08/2026 y ningun SP escribia (por eso el KPI "Sin
// clasificar" cuenta casi todo el universo), y las fechas de auditoria.
import { pool } from './db.mjs'

const SPS = [
  ['sp_b2b_company_register', `
CREATE OR REPLACE PROCEDURE public.sp_b2b_company_register(
    IN p_data jsonb, OUT result integer, OUT message text, OUT company_id integer)
LANGUAGE plpgsql AS $$
DECLARE
    v_company   jsonb := COALESCE(p_data->'company', '{}'::jsonb);
    v_contact   jsonb;
    v_affiliate jsonb;
    v_new_id    int;
    -- Se compara por digitos: '20100073723' y '20-100073723 ' son el mismo RUC.
    v_ruc       text := NULLIF(regexp_replace(COALESCE(v_company->>'document_number',''), '[^0-9]', '', 'g'), '');
    v_duplicada text;
BEGIN
    -- Las guardas viven aca y no en el front, que es el unico lugar donde la
    -- regla no se puede saltar. Sin razon social la empresa es invisible en
    -- toda la pantalla; sin RUC no se puede cruzar con nada.
    IF NULLIF(trim(COALESCE(v_company->>'razon_social', '')), '') IS NULL THEN
        result := 0; message := 'La razon social es obligatoria'; company_id := NULL;
        RETURN;
    END IF;

    IF v_ruc IS NULL THEN
        result := 0; message := 'El RUC es obligatorio'; company_id := NULL;
        RETURN;
    END IF;

    SELECT c.razon_social INTO v_duplicada
      FROM public.companies c
     WHERE c.active = 'Y'
       AND regexp_replace(COALESCE(c.document_number,''), '[^0-9]', '', 'g') = v_ruc
     LIMIT 1;
    IF FOUND THEN
        result := 0; company_id := NULL;
        message := 'Ya existe una empresa con el RUC ' || v_ruc || ': ' || COALESCE(v_duplicada, '(sin nombre)');
        RETURN;
    END IF;

    INSERT INTO public.companies (
        razon_social, razon_comercial, document_number, is_intermediary,
        cat_sector, cat_classification, active, registration_date
    ) VALUES (
        v_company->>'razon_social',
        v_company->>'razon_comercial',
        trim(v_company->>'document_number'),
        -- El front habla 'Y'/'N'; postgres los castea a boolean sin ayuda.
        COALESCE((v_company->>'is_intermediary')::boolean, false),
        (v_company->>'cat_sector')::int,
        (v_company->>'cat_classification')::int,
        'Y',
        CURRENT_TIMESTAMP
    )
    RETURNING companies.company_id INTO v_new_id;

    IF jsonb_array_length(COALESCE(p_data->'contacts', '[]'::jsonb)) > 0 THEN
        FOR v_contact IN SELECT * FROM jsonb_array_elements(p_data->'contacts')
        LOOP
            INSERT INTO public.company_contacts (
                company_id, contact_name, contact_position,
                contact_phone, contact_email, is_primary, active
            ) VALUES (
                v_new_id,
                v_contact->>'contact_name',
                v_contact->>'contact_position',
                v_contact->>'contact_phone',
                v_contact->>'contact_email',
                COALESCE((v_contact->>'is_primary')::boolean, false),
                'Y'
            );
        END LOOP;
    END IF;

    IF COALESCE((v_company->>'is_intermediary')::boolean, false) = true
       AND jsonb_array_length(COALESCE(p_data->'affiliate_ids', '[]'::jsonb)) > 0 THEN
        FOR v_affiliate IN SELECT * FROM jsonb_array_elements(p_data->'affiliate_ids')
        LOOP
            INSERT INTO public.company_affiliates (
                parent_company_id, child_company_id, active
            ) VALUES (v_new_id, (v_affiliate::text)::int, 'Y')
            ON CONFLICT DO NOTHING;
        END LOOP;
    END IF;

    result     := 1;
    message    := 'Empresa registrada correctamente';
    company_id := v_new_id;

EXCEPTION WHEN OTHERS THEN
    result     := 0;
    message    := SQLERRM;
    company_id := NULL;
END;
$$;`],

  ['sp_b2b_company_update', `
CREATE OR REPLACE PROCEDURE public.sp_b2b_company_update(
    IN p_company_id integer, IN p_data jsonb, OUT result integer, OUT message text)
LANGUAGE plpgsql AS $$
DECLARE
    v_company   jsonb := COALESCE(p_data->'company', '{}'::jsonb);
    v_contact   jsonb;
    v_affiliate jsonb;
    v_ruc       text := NULLIF(regexp_replace(COALESCE(v_company->>'document_number',''), '[^0-9]', '', 'g'), '');
    v_duplicada text;
BEGIN
    -- El RUC no se exige al editar: 37 empresas migradas del Sheet no lo tienen
    -- y hacerlo obligatorio aca las volveria inmodificables. El duplicado si se
    -- rechaza, tambien al editar.
    IF v_ruc IS NOT NULL THEN
        SELECT c.razon_social INTO v_duplicada
          FROM public.companies c
         WHERE c.active = 'Y'
           AND c.company_id <> p_company_id
           AND regexp_replace(COALESCE(c.document_number,''), '[^0-9]', '', 'g') = v_ruc
         LIMIT 1;
        IF FOUND THEN
            result := 0;
            message := 'Ya existe otra empresa con el RUC ' || v_ruc || ': ' || COALESCE(v_duplicada, '(sin nombre)');
            RETURN;
        END IF;
    END IF;

    -- COALESCE en cada campo: lo que el formulario no manda no se pisa.
    UPDATE public.companies SET
        razon_social       = COALESCE(v_company->>'razon_social',       razon_social),
        razon_comercial    = COALESCE(v_company->>'razon_comercial',    razon_comercial),
        document_number    = COALESCE(trim(v_company->>'document_number'), document_number),
        is_intermediary    = COALESCE((v_company->>'is_intermediary')::boolean, is_intermediary),
        cat_sector         = COALESCE((v_company->>'cat_sector')::int,         cat_sector),
        cat_classification = COALESCE((v_company->>'cat_classification')::int, cat_classification),
        modification_date  = CURRENT_TIMESTAMP
    WHERE company_id = p_company_id;

    UPDATE public.company_contacts SET active = 'N' WHERE company_id = p_company_id;

    IF jsonb_array_length(COALESCE(p_data->'contacts', '[]'::jsonb)) > 0 THEN
        FOR v_contact IN SELECT * FROM jsonb_array_elements(p_data->'contacts')
        LOOP
            INSERT INTO public.company_contacts (
                company_id, contact_name, contact_position,
                contact_phone, contact_email, is_primary, active
            ) VALUES (
                p_company_id,
                v_contact->>'contact_name',
                v_contact->>'contact_position',
                v_contact->>'contact_phone',
                v_contact->>'contact_email',
                COALESCE((v_contact->>'is_primary')::boolean, false),
                'Y'
            );
        END LOOP;
    END IF;

    UPDATE public.company_affiliates SET active = 'N' WHERE parent_company_id = p_company_id;

    IF COALESCE((v_company->>'is_intermediary')::boolean, false) = true
       AND jsonb_array_length(COALESCE(p_data->'affiliate_ids', '[]'::jsonb)) > 0 THEN
        FOR v_affiliate IN SELECT * FROM jsonb_array_elements(p_data->'affiliate_ids')
        LOOP
            INSERT INTO public.company_affiliates (
                parent_company_id, child_company_id, active
            ) VALUES (p_company_id, (v_affiliate::text)::int, 'Y')
            ON CONFLICT DO NOTHING;
        END LOOP;
    END IF;

    result  := 1;
    message := 'Empresa actualizada correctamente';

EXCEPTION WHEN OTHERS THEN
    result  := 0;
    message := SQLERRM;
END;
$$;`]
]

const client = await pool.connect()
try {
  const { rows: [{ current_database: db }] } = await client.query('SELECT current_database()')
  console.log('BD destino:', db)
  for (const [nombre, sql] of SPS) {
    await client.query(sql)
    console.log('  OK', nombre)
  }
} finally {
  client.release()
  await pool.end()
}
