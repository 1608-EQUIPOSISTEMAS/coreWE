-- ============================================================
-- Tabla classroom_audit_rubric
-- Almacena la rubrica de evaluacion al docente, una fila por
-- (edicion, numero de sesion). Los criterios marcados se guardan
-- como JSONB para mantener flexibilidad si la rubrica evoluciona.
--
-- Estructura del JSONB `criteria`:
--   {
--     "interaction.1": true,  "interaction.2": false, ...
--     "content.1": true, ...,
--     "environment.1": true, ...,
--     "communication.1": true, ...
--   }
-- Las claves no presentes se asumen como false.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.classroom_audit_rubric (
  rubric_id          SERIAL PRIMARY KEY,
  program_edition_id INTEGER NOT NULL REFERENCES public.program_editions(edition_num_id) ON DELETE CASCADE,
  session_number     INTEGER NOT NULL CHECK (session_number > 0),
  criteria           JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by         INTEGER REFERENCES public.users(user_id),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (program_edition_id, session_number)
);

CREATE INDEX IF NOT EXISTS idx_car_edition
  ON public.classroom_audit_rubric (program_edition_id);

COMMENT ON TABLE public.classroom_audit_rubric IS
  'Rubrica de evaluacion al docente por sesion. Una fila por (edicion, sesion).';
