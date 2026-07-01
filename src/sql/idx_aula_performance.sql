-- =====================================================================
-- INDICES FK PARA LA CARGA DEL AULA (Lista de Notas / classroomStudentsList)
-- =====================================================================
-- El detalle del aula (edition.repository.js -> classroomStudentsList) arma
-- la fila de cada alumno con varios LATERAL por persona: telefono, correo,
-- acceso Odoo y membresia. Sin estos indices de llave foranea, cada LATERAL
-- hacia un Seq Scan completo POR ALUMNO:
--   * person_contacts (~20k filas) escaneada 2 veces por alumno (tel + correo)
--   * enrollments (~10k filas) escaneada por alumno (Odoo + membresia)
-- Medido en una edicion de 74 alumnos: ~73 ms solo el LATERAL de telefono.
-- Con estos indices la misma consulta baja a ~2 ms y 0 seq scans.
--
-- PostgreSQL NO crea indices de FK automaticamente; hay que declararlos.
-- Idempotente (IF NOT EXISTS). Tablas chicas: el lock de CREATE INDEX dura
-- milisegundos. En tablas grandes usar CREATE INDEX CONCURRENTLY (fuera de
-- transaccion) en su lugar.
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_person_contacts_person
  ON public.person_contacts (person_id);

CREATE INDEX IF NOT EXISTS idx_enrollments_customer
  ON public.enrollments (customer_id);

CREATE INDEX IF NOT EXISTS idx_enrollments_program_edition
  ON public.enrollments (program_edition_id);

CREATE INDEX IF NOT EXISTS idx_enrollments_parent
  ON public.enrollments (parent_enrollment_id)
  WHERE parent_enrollment_id IS NOT NULL;
