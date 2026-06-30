-- Tablas hijas del docente que los SPs sp_instructor_get / sp_instructor_update
-- ya esperaban en la BD pero que nunca se crearon -> "relation does not exist"
-- al abrir cualquier docente en /producto/docentes. Idempotente.

-- 1) Adjuntos por registro financiero. get LEE (jsonb_agg de document_url
--    WHERE active='Y'); update ESCRIBE (DELETE + INSERT instructor_financial_id,
--    document_url, active).
CREATE TABLE IF NOT EXISTS public.instructor_financial_attachments (
  instructor_financial_attachment_id SERIAL PRIMARY KEY,
  instructor_financial_id            INTEGER NOT NULL
    REFERENCES public.instructor_financials(instructor_financial_id) ON DELETE CASCADE,
  document_url                       TEXT NOT NULL,
  active                             CHAR(1) NOT NULL DEFAULT 'Y',
  created_at                         TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ifa_financial
  ON public.instructor_financial_attachments (instructor_financial_id);

-- 2) Programas que dicta el docente. get LEE (instructor_program_id, program_id,
--    profile_summary, active, registration_date); update ESCRIBE las columnas de
--    abajo (incluye auditoria user_registration_id / modification_date).
CREATE TABLE IF NOT EXISTS public.instructor_programs (
  instructor_program_id SERIAL PRIMARY KEY,
  instructor_id         INTEGER NOT NULL
    REFERENCES public.instructors(instructor_id) ON DELETE CASCADE,
  program_id            INTEGER NOT NULL
    REFERENCES public.programs(program_id),
  profile_summary       TEXT,
  active                CHAR(1) NOT NULL DEFAULT 'Y',
  user_registration_id  INTEGER,
  user_modification_id  INTEGER,
  registration_date     TIMESTAMP NOT NULL DEFAULT NOW(),
  modification_date     TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_iprog_instructor
  ON public.instructor_programs (instructor_id);
