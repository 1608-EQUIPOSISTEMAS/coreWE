-- ============================================================================
-- public.sp_search_phone_get — historial del telefono al presionar Enter
-- ============================================================================
-- El SP no estaba versionado en el repo. Queda aqui al tocarlo (Boy Scout).
--
-- UNICO cambio de fondo: el bloque "LOGICA DE MOMENTO" ya no se calcula inline
-- contra `consolidated`. Ahora delega en public.fn_client_moment (ver
-- fn_client_moment.sql), que es la misma regla que aplica el SP de registro.
-- Antes miraba solo el historico pre-ERP y dejaba en NUEVO a cualquiera que
-- hubiera consultado ya dentro del ERP.
-- ============================================================================
CREATE OR REPLACE PROCEDURE public.sp_search_phone_get(
  IN p_phone character varying,
  INOUT p_cur refcursor DEFAULT NULL::refcursor
)
LANGUAGE plpgsql
AS $procedure$
BEGIN
  -- Nombre por defecto al cursor
  IF p_cur IS NULL THEN
    p_cur := 'cur_search_phone_get';
  END IF;

  OPEN p_cur FOR
  WITH client_data AS (
      SELECT * FROM public.consolidated
      WHERE phone = p_phone
  )
  SELECT
    -- 1. MOMENTO DEL CLIENTE (regla unica, compartida con el registro)
    (SELECT alias FROM public."catalog"
      WHERE catalog_id = public.fn_client_moment(p_phone)) AS cat_client_moment,

    -- 2. LÓGICA DE MEMBRESÍA
    (
        SELECT
            CASE
                -- Si la fecha es "reciente" (mayor a hoy menos 1 año), devolvemos el ID
                WHEN formatedDate >= (CURRENT_DATE - INTERVAL '1 year') THEN membership_tier_id
                -- Si la fecha es muy antigua (o nula), devolvemos NULL
                ELSE NULL
            END
        FROM client_data
        WHERE membership_tier_id IS NOT NULL  -- 1. Solo consideramos si existe ID
        ORDER BY formatedDate DESC            -- 2. Tomamos el registro más actual
        LIMIT 1
    ) AS membership_tier_id,

    -- 3. ARRAY DE HISTÓRICO CONSOLIDADO
    (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'date', cd.formatedDate,
            'program', cd.program,
            'full_name', cd.full_name,
            'cat_client_moment', cd.cat_client_moment,
            'cat_client_moment_label', cox.description
          ) ORDER BY cd.formatedDate DESC
        ),
        '[]'::jsonb
      )
      FROM client_data cd
      LEFT JOIN catalog cox ON cox.catalog_id = cd.cat_client_moment
    ) AS legacy_details,

    -- 4. ARRAY DE HISTÓRICO LEADS
    (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'date', lds.registration_date,
            'program', pv.description,
            'edition', ed.specific_code,
            'full_name', lds.full_name,
            'user_registration_full_name', CONCAT(per.first_name, ' ', per.last_name),
            'cat_status_lead_label', ckk.description,
            'count_calling', (SELECT COUNT(*) FROM lead_contact_attempts xx WHERE xx.lead_id = lds.lead_id)
          ) ORDER BY lds.registration_date DESC
        ),
        '[]'::jsonb
      )
      FROM leads lds
      INNER JOIN catalog ckk ON ckk.catalog_id = lds.cat_status_lead
      LEFT JOIN users use ON use.user_id = lds.user_registration_id
        LEFT JOIN persons per ON per.person_id = use.person_id
      LEFT JOIN program_versions pv ON pv.program_version_id = lds.program_version_id
      LEFT JOIN program_editions ed ON ed.edition_num_id = lds.program_edition_id
        LEFT JOIN program_versions pvx ON pvx.program_version_id = ed.program_version_id
      WHERE lds.origin_phone = p_phone
    ) AS lead_details;

END;
$procedure$;
