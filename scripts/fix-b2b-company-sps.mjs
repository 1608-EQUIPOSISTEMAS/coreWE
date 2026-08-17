// Reescribe sp_b2b_company_list y sp_b2b_company_get contra el esquema REAL.
//
// sp_b2b_company_list venia escrito contra una company_contacts imaginaria
// (columnas is_main/phone/email) y contra b2b_contracts.contract_id, que no
// existe. La pantalla de Empresas devolvia error 500 en cada carga.
//
// sp_b2b_company_get devolvia c.*, y ahi is_intermediary sale como boolean,
// pero el formulario compara contra 'Y'. Resultado: al editar una intermediaria
// el switch aparecia apagado y al guardar se perdian las empresas socias.
// Ambos SPs normalizan ahora el flag a 'Y'/'N', que es lo que el front habla.
import { pool } from './db.mjs'

const SPS = [
  ['sp_b2b_company_list', `
    CREATE OR REPLACE PROCEDURE public.sp_b2b_company_list(IN p_filters jsonb, INOUT p_result refcursor)
    LANGUAGE plpgsql AS $$
    DECLARE
      v_search         text := NULLIF(trim(COALESCE(p_filters->>'q', p_filters->>'search')), '');
      v_exclude_id     int  := (p_filters->>'exclude_company_id')::int;
      v_only_contracts bool := COALESCE((p_filters->>'only_with_contracts')::bool, false);
      v_page           int  := COALESCE((p_filters->>'page')::int, 1);
      v_size           int  := COALESCE((p_filters->>'size')::int, 25);
    BEGIN
      OPEN p_result FOR
        WITH principal AS (
          -- Un contacto por empresa: el marcado principal, y si no hay, el mas viejo.
          SELECT DISTINCT ON (cc.company_id)
                 cc.company_id, cc.contact_name, cc.contact_phone, cc.contact_email
            FROM public.company_contacts cc
           WHERE cc.active = 'Y'
           ORDER BY cc.company_id, cc.is_primary DESC, cc.contact_id
        ),
        contratos AS (
          SELECT bc.company_id,
                 COUNT(*) FILTER (
                   WHERE bc.active = 'Y'
                     AND (bc.end_date IS NULL OR bc.end_date >= CURRENT_DATE)
                 ) AS activos
            FROM public.b2b_contracts bc
           GROUP BY bc.company_id
        )
        SELECT
          c.company_id,
          c.razon_social,
          c.razon_comercial                                        AS commercial_name,
          c.document_number,
          CASE WHEN c.is_intermediary THEN 'Y' ELSE 'N' END        AS is_intermediary,
          c.cat_sector,
          c.cat_classification,
          c.active,
          p.contact_name                                           AS primary_contact_name,
          p.contact_phone                                          AS primary_contact_phone,
          p.contact_email                                          AS primary_contact_email,
          COALESCE(t.activos, 0)                                   AS active_contracts_count,
          COUNT(*) OVER()                                          AS total_count
        FROM public.companies c
        LEFT JOIN principal p ON p.company_id = c.company_id
        LEFT JOIN contratos t ON t.company_id = c.company_id
        WHERE c.active = 'Y'
          AND (v_search IS NULL
               OR c.razon_social    ILIKE '%'||v_search||'%'
               OR c.razon_comercial ILIKE '%'||v_search||'%'
               OR c.document_number ILIKE '%'||v_search||'%')
          AND (v_exclude_id IS NULL OR c.company_id <> v_exclude_id)
          AND (NOT v_only_contracts OR COALESCE(t.activos, 0) > 0)
        ORDER BY c.razon_social
        LIMIT v_size OFFSET (v_page - 1) * v_size;
    END;
    $$;
  `],

  ['sp_b2b_company_get', `
    CREATE OR REPLACE PROCEDURE public.sp_b2b_company_get(IN p_company_id integer, INOUT p_result refcursor)
    LANGUAGE plpgsql AS $$
    BEGIN
      OPEN p_result FOR
        SELECT
          c.company_id,
          c.razon_social,
          c.razon_comercial                                 AS commercial_name,
          c.document_number,
          c.cat_type_document,
          CASE WHEN c.is_intermediary THEN 'Y' ELSE 'N' END AS is_intermediary,
          c.cat_sector,
          c.cat_classification,
          c.active,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                     'contact_id',       cc.contact_id,
                     'contact_name',     cc.contact_name,
                     'contact_position', cc.contact_position,
                     'contact_phone',    cc.contact_phone,
                     'contact_email',    cc.contact_email,
                     'is_primary',       CASE WHEN cc.is_primary THEN 'Y' ELSE 'N' END,
                     'person_id',        cc.person_id)
                   ORDER BY cc.is_primary DESC, cc.contact_id)
              FROM public.company_contacts cc
             WHERE cc.company_id = c.company_id AND cc.active = 'Y'
          ), '[]'::jsonb) AS contacts,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                     'affiliate_id',    ca.affiliate_id,
                     'company_id',      hija.company_id,
                     'razon_social',    hija.razon_social,
                     'document_number', hija.document_number))
              FROM public.company_affiliates ca
              JOIN public.companies hija ON hija.company_id = ca.child_company_id
             WHERE ca.parent_company_id = c.company_id AND ca.active = 'Y'
          ), '[]'::jsonb) AS affiliates
        FROM public.companies c
        WHERE c.company_id = p_company_id;
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
