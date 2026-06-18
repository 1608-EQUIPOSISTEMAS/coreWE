-- =====================================================================
-- Lista de Notas por alumno por aula (ISO 21001 - Calidad Educativa).
-- Una fila por enrollment (UNIQUE). Reemplaza el formato de asistencia:
-- la nota se compone de tests por sesion, participacion y proyecto
-- integrador (entregable parcial + final).
--
--   tests            {"1": 4, "2": 5, ...}        puntaje 0-5 por sesion
--   participation    {"1": true, "2": false, ...} check por sesion
--   partial_criteria {"1": 7, "2": 6, "3": 3}     maximos 8 / 8 / 4 (suma /20)
--   final_criteria   {"1": 4, "2": 5, "3": 4, "4": 5}  maximos 5 c/u (suma /20)
--
-- Totales denormalizados: los calcula el usecase en cada save (la formula
-- vive en edition.entity.js, unica fuente de verdad):
--   test_score          = promedio(tests sobre sesiones del aula) * 4   /20
--   participation_score = ROUND(checks * 2 / sesiones)                  0-2
--   partial_score       = suma de partial_criteria                      /20
--   final_deliv_score   = suma de final_criteria                        /20
--   final_grade         = test*0.30 + parcial*0.30 + final*0.40 + participacion
--
-- NOTA: esta tabla se auto-crea desde edition.repository.js
-- (ensureGradesTable). Este archivo es referencia/documentacion.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.classroom_student_grades (
  grade_id            SERIAL PRIMARY KEY,
  program_edition_id  INTEGER NOT NULL REFERENCES public.program_editions(edition_num_id) ON DELETE CASCADE,
  enrollment_id       INTEGER NOT NULL REFERENCES public.enrollments(enrollment_id) ON DELETE CASCADE,
  tests               JSONB NOT NULL DEFAULT '{}'::jsonb,
  participation       JSONB NOT NULL DEFAULT '{}'::jsonb,
  partial_criteria    JSONB NOT NULL DEFAULT '{}'::jsonb,
  final_criteria      JSONB NOT NULL DEFAULT '{}'::jsonb,
  test_score          NUMERIC(5,2),
  participation_score NUMERIC(4,2),
  partial_score       NUMERIC(5,2),
  final_deliv_score   NUMERIC(5,2),
  final_grade         NUMERIC(5,2),
  group_number        INTEGER,
  tracking_code       TEXT,
  updated_by          INTEGER REFERENCES public.users(user_id),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (enrollment_id)
);

CREATE INDEX IF NOT EXISTS idx_csg_edition
  ON public.classroom_student_grades (program_edition_id);
