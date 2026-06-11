-- ============================================================================
-- SAP Credentials: registro de usuario/contrasena SAP por enrollment para
-- cursos online de categoria SAP.
--
-- CAMBIO (2026-06): las credenciales YA NO se autogeneran. El equipo FICO las
-- escribe a mano en el momento del envio del correo de bienvenida online
-- (template confirmacion-online.js). Esta tabla solo guarda lo ultimo enviado,
-- como registro/soporte; el formulario siempre arranca en blanco.
--
-- Disparado desde email-confirmation.usecases.js > sendConfirmationEmail (via
-- repo.setSapCredentials) cuando el programa es categoria SAP + modalidad online
-- y el operador ingreso ambas credenciales.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.enrollment_sap_credentials (
  enrollment_id INTEGER PRIMARY KEY
    REFERENCES public.enrollments(enrollment_id) ON DELETE CASCADE,
  sap_username  TEXT NOT NULL,
  sap_password  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enrollment_sap_credentials_username
  ON public.enrollment_sap_credentials (sap_username);

-- Columna nueva para instalaciones que ya tenian la tabla del modelo anterior.
ALTER TABLE public.enrollment_sap_credentials
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- El modelo anterior fijaba password '1234567' por defecto y autogeneraba el
-- usuario; con entrada manual ambos son obligatorios y no tienen default.
ALTER TABLE public.enrollment_sap_credentials
  ALTER COLUMN sap_password DROP DEFAULT;

-- ----------------------------------------------------------------------------
-- Limpieza del modelo de autogeneracion (idempotente). El usuario/contrasena ya
-- no salen de una secuencia ni de un password fijo.
DROP FUNCTION IF EXISTS public.sp_assign_sap_credentials(INTEGER);
DROP SEQUENCE IF EXISTS public.sap_credential_seq;

COMMIT;
