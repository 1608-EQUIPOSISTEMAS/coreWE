// Arregla sp_b2b_company_register / _update: leian las claves en la raiz del
// payload (p_data->>'razon_social') pero el formulario las manda anidadas en
// 'company', asi que la empresa se creaba con razon social y RUC en NULL. Y
// casteaban is_intermediary con ::boolean cuando el front manda 'Y'/'N', lo que
// revienta y el EXCEPTION WHEN OTHERS lo devolvia como un "result = 0" mudo.
//
// Mismo remedio que en los SPs de contrato: aceptar las dos formas con
// COALESCE(p_data->'company', p_data) y normalizar los booleanos 'Y'/'N'.
//
// Idempotente. Corre contra lo que diga Backend/.env (BD de pruebas).
import { pool } from './db.mjs'

// 'Y'/'N' del formulario, true/false de un cliente que mande JSON crudo.
const SI = (expr) => `COALESCE(lower(NULLIF(${expr}, '')) IN ('y', 'true', 't'), false)`

const SPS = [
  ['sp_b2b_company_register', `
    CREATE OR REPLACE PROCEDURE public.sp_b2b_company_register(
      IN p_data jsonb, OUT result integer, OUT message text, OUT company_id integer)
    LANGUAGE plpgsql AS $$
    DECLARE
      c           jsonb := COALESCE(p_data->'company', p_data);
      v_contacts  jsonb := COALESCE(p_data->'contacts', c->'contacts', '[]'::jsonb);
      v_afiliadas jsonb := COALESCE(p_data->'affiliate_ids', c->'affiliate_ids', '[]'::jsonb);
      v_contact   jsonb;
      v_affiliate jsonb;
      v_new_id    int;
    BEGIN
      IF NULLIF(trim(COALESCE(c->>'razon_social', '')), '') IS NULL THEN
        result := 0; message := 'Falta la razon social'; RETURN;
      END IF;

      INSERT INTO public.companies (
        razon_social, razon_comercial, document_number, cat_type_document,
        is_intermediary, cat_sector, cat_classification, active, registration_date)
      VALUES (
        c->>'razon_social',
        NULLIF(c->>'razon_comercial', ''),
        NULLIF(c->>'document_number', ''),
        NULLIF(c->>'cat_type_document', '')::int,
        ${SI("c->>'is_intermediary'")},
        NULLIF(c->>'cat_sector', '')::int,
        NULLIF(c->>'cat_classification', '')::int,
        'Y', now())
      RETURNING companies.company_id INTO v_new_id;

      FOR v_contact IN SELECT * FROM jsonb_array_elements(v_contacts) LOOP
        INSERT INTO public.company_contacts (
          company_id, contact_name, contact_position, contact_phone,
          contact_email, is_primary, active)
        VALUES (
          v_new_id,
          v_contact->>'contact_name',
          NULLIF(v_contact->>'contact_position', ''),
          NULLIF(v_contact->>'contact_phone', ''),
          NULLIF(v_contact->>'contact_email', ''),
          ${SI("v_contact->>'is_primary'")},
          'Y');
      END LOOP;

      -- Las afiliadas solo tienen sentido si la empresa es intermediaria.
      IF ${SI("c->>'is_intermediary'")} THEN
        FOR v_affiliate IN SELECT * FROM jsonb_array_elements(v_afiliadas) LOOP
          INSERT INTO public.company_affiliates (parent_company_id, child_company_id, active)
          VALUES (v_new_id, (v_affiliate #>> '{}')::int, 'Y')
          ON CONFLICT DO NOTHING;
        END LOOP;
      END IF;

      result := 1; message := 'Empresa registrada correctamente'; company_id := v_new_id;
    EXCEPTION WHEN OTHERS THEN
      -- El mensaje SI viaja al usuario: sin el, la pantalla solo diria "error".
      result := 0; message := SQLERRM; company_id := NULL;
    END;
    $$;
  `],

  ['sp_b2b_company_update', `
    CREATE OR REPLACE PROCEDURE public.sp_b2b_company_update(
      IN p_company_id integer, IN p_data jsonb, OUT result integer, OUT message text)
    LANGUAGE plpgsql AS $$
    DECLARE
      c           jsonb := COALESCE(p_data->'company', p_data);
      v_contacts  jsonb := COALESCE(p_data->'contacts', c->'contacts', '[]'::jsonb);
      v_afiliadas jsonb := COALESCE(p_data->'affiliate_ids', c->'affiliate_ids', '[]'::jsonb);
      v_contact   jsonb;
      v_affiliate jsonb;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.companies WHERE company_id = p_company_id) THEN
        result := 0; message := 'La empresa no existe'; RETURN;
      END IF;

      -- 'c ? clave' y no COALESCE: una clave presente en null significa
      -- "borrame el dato", una clave ausente significa "no lo toques".
      UPDATE public.companies SET
        razon_social       = CASE WHEN c ? 'razon_social'       THEN c->>'razon_social'       ELSE razon_social END,
        razon_comercial    = CASE WHEN c ? 'razon_comercial'    THEN NULLIF(c->>'razon_comercial', '')    ELSE razon_comercial END,
        document_number    = CASE WHEN c ? 'document_number'    THEN NULLIF(c->>'document_number', '')    ELSE document_number END,
        cat_type_document  = CASE WHEN c ? 'cat_type_document'  THEN NULLIF(c->>'cat_type_document', '')::int  ELSE cat_type_document END,
        is_intermediary    = CASE WHEN c ? 'is_intermediary'    THEN ${SI("c->>'is_intermediary'")} ELSE is_intermediary END,
        cat_sector         = CASE WHEN c ? 'cat_sector'         THEN NULLIF(c->>'cat_sector', '')::int         ELSE cat_sector END,
        cat_classification = CASE WHEN c ? 'cat_classification' THEN NULLIF(c->>'cat_classification', '')::int ELSE cat_classification END,
        modification_date  = now()
      WHERE company_id = p_company_id;

      -- Los hijos se reemplazan enteros solo si la clave viene: guardar el
      -- contrato sin mandar 'contacts' no puede dejar a la empresa sin contactos.
      IF p_data ? 'contacts' OR c ? 'contacts' THEN
        UPDATE public.company_contacts SET active = 'N' WHERE company_id = p_company_id;
        FOR v_contact IN SELECT * FROM jsonb_array_elements(v_contacts) LOOP
          INSERT INTO public.company_contacts (
            company_id, contact_name, contact_position, contact_phone,
            contact_email, is_primary, active)
          VALUES (
            p_company_id,
            v_contact->>'contact_name',
            NULLIF(v_contact->>'contact_position', ''),
            NULLIF(v_contact->>'contact_phone', ''),
            NULLIF(v_contact->>'contact_email', ''),
            ${SI("v_contact->>'is_primary'")},
            'Y');
        END LOOP;
      END IF;

      IF p_data ? 'affiliate_ids' OR c ? 'affiliate_ids' THEN
        UPDATE public.company_affiliates SET active = 'N' WHERE parent_company_id = p_company_id;
        IF ${SI("c->>'is_intermediary'")} THEN
          FOR v_affiliate IN SELECT * FROM jsonb_array_elements(v_afiliadas) LOOP
            INSERT INTO public.company_affiliates (parent_company_id, child_company_id, active)
            VALUES (p_company_id, (v_affiliate #>> '{}')::int, 'Y')
            ON CONFLICT (parent_company_id, child_company_id) DO UPDATE SET active = 'Y';
          END LOOP;
        END IF;
      END IF;

      result := 1; message := 'Empresa actualizada correctamente';
    EXCEPTION WHEN OTHERS THEN
      result := 0; message := SQLERRM;
    END;
    $$;
  `],
]

const cliente = await pool.connect()
try {
  const { rows: [donde] } = await cliente.query('SELECT current_database() AS db, inet_server_port() AS puerto')
  console.log(`BD destino: ${donde.db}:${donde.puerto}\n`)
  await cliente.query('BEGIN')
  for (const [nombre, sql] of SPS) {
    await cliente.query(sql)
    console.log(`✓ ${nombre}`)
  }
  await cliente.query('COMMIT')
} catch (err) {
  await cliente.query('ROLLBACK')
  throw err
} finally {
  cliente.release()
  await pool.end()
}
