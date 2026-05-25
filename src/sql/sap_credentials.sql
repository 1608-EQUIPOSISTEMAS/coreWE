-- ============================================================================
-- SAP Credentials: asignacion automatica de usuario/contrasena SAP por
-- enrollment para cursos online de categoria SAP.
--
-- Disparado desde fico.service.js > sendConfirmationEmail antes de armar el
-- correo de bienvenida (template confirmacion-online.js).
--
-- Reglas:
--   - Se asigna por enrollment (no por persona).
--   - Solo aplica si el programa tiene cat_category = we_program_category_sap
--     y cat_model_modality = we_modality_online.
--   - Username = 'SAP_' || nextval(sap_credential_seq), arrancando en 4000.
--   - Password fija '1234567'.
--   - Idempotente: si ya existe credencial para el enrollment, devuelve la
--     misma sin consumir un nuevo correlativo.
-- ============================================================================

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.sap_credential_seq
  START WITH 4000
  INCREMENT BY 1
  MINVALUE 4000
  NO MAXVALUE
  CACHE 1;

CREATE TABLE IF NOT EXISTS public.enrollment_sap_credentials (
  enrollment_id INTEGER PRIMARY KEY
    REFERENCES public.enrollments(enrollment_id) ON DELETE CASCADE,
  sap_username  TEXT NOT NULL UNIQUE,
  sap_password  TEXT NOT NULL DEFAULT '1234567',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enrollment_sap_credentials_username
  ON public.enrollment_sap_credentials (sap_username);

CREATE OR REPLACE FUNCTION public.sp_assign_sap_credentials (p_enrollment_id INTEGER)
RETURNS TABLE (sap_username TEXT, sap_password TEXT)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_sap_cat_id     INTEGER;
  v_online_mod_id  INTEGER;
  v_cat_category   INTEGER;
  v_cat_modality   INTEGER;
BEGIN
  SELECT catalog_id INTO v_sap_cat_id
    FROM public.catalog WHERE alias = 'we_program_category_sap' LIMIT 1;
  SELECT catalog_id INTO v_online_mod_id
    FROM public.catalog WHERE alias = 'we_modality_online' LIMIT 1;

  IF v_sap_cat_id IS NULL OR v_online_mod_id IS NULL THEN
    RAISE EXCEPTION
      'Aliases we_program_category_sap o we_modality_online no existen en catalog';
  END IF;

  SELECT p.cat_category, p.cat_model_modality
    INTO v_cat_category, v_cat_modality
    FROM public.enrollments e
    JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    JOIN public.programs p          ON p.program_id          = pv.program_id
   WHERE e.enrollment_id = p_enrollment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment % no existe', p_enrollment_id;
  END IF;

  IF v_cat_category IS DISTINCT FROM v_sap_cat_id
     OR v_cat_modality IS DISTINCT FROM v_online_mod_id THEN
    RETURN;
  END IF;

  INSERT INTO public.enrollment_sap_credentials (enrollment_id, sap_username)
  VALUES (p_enrollment_id, 'SAP_' || nextval('public.sap_credential_seq'))
  ON CONFLICT (enrollment_id) DO NOTHING;

  RETURN QUERY
    SELECT esc.sap_username, esc.sap_password
      FROM public.enrollment_sap_credentials esc
     WHERE esc.enrollment_id = p_enrollment_id;
END
$function$;

COMMIT;

-- ============================================================================
-- BACKFILL OPCIONAL (descomenta si quieres asignar SAP_4000+ a los 16
-- enrollments SAP online existentes en orden cronologico antes del primer
-- envio real). Si no, los proximos envios generaran credencial al vuelo.
-- ============================================================================
-- DO $backfill$
-- DECLARE
--   r RECORD;
-- BEGIN
--   FOR r IN
--     SELECT e.enrollment_id
--       FROM public.enrollments e
--       JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
--       JOIN public.programs p          ON p.program_id          = pv.program_id
--       LEFT JOIN public.enrollment_sap_credentials esc ON esc.enrollment_id = e.enrollment_id
--      WHERE p.cat_category = (SELECT catalog_id FROM public.catalog WHERE alias='we_program_category_sap')
--        AND p.cat_model_modality = (SELECT catalog_id FROM public.catalog WHERE alias='we_modality_online')
--        AND esc.enrollment_id IS NULL
--      ORDER BY e.registration_date NULLS LAST, e.enrollment_id
--   LOOP
--     PERFORM public.sp_assign_sap_credentials(r.enrollment_id);
--   END LOOP;
-- END $backfill$;
