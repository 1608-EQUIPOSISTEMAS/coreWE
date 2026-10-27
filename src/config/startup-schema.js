import { pool } from '../shared/db/pool.js'

// Cambios de BD que se aplican solos al arrancar el backend (app.js), para que
// el despliegue no dependa de correr scripts a mano: scripts/ no se versiona.
// Todo es idempotente: correrlo en cada arranque deja el mismo estado.
// ponytail: un solo bloque SQL; si esto crece a muchas versiones, pasar a un
// runner de migraciones de verdad (node-pg-migrate) con tabla de control.
const SQL = `
-- Membresias Vigentes: checks S1..S7, M1..M12 y R1 por inscripcion (26/10/26).
CREATE TABLE IF NOT EXISTS public.academic_membership_checks (
  enrollment_id         integer     NOT NULL REFERENCES public.enrollments(enrollment_id),
  checkpoint            varchar(3)  NOT NULL,
  registration_date     timestamp with time zone NOT NULL DEFAULT now(),
  user_registration_id  integer     REFERENCES public.users(user_id),
  PRIMARY KEY (enrollment_id, checkpoint)
);

-- Solo si falta o es la version vieja (sin R1): rehacerla en cada arranque
-- bloquearia la tabla sin necesidad.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'academic_membership_checks_checkpoint_chk'
                    AND pg_get_constraintdef(oid) LIKE '%R1%') THEN
    ALTER TABLE public.academic_membership_checks
      DROP CONSTRAINT IF EXISTS academic_membership_checks_checkpoint_chk;
    ALTER TABLE public.academic_membership_checks
      ADD CONSTRAINT academic_membership_checks_checkpoint_chk
      CHECK (checkpoint ~ '^(S[1-7]|M([1-9]|1[0-2])|R1)$');
  END IF;
END $$;

-- Opciones nuevas de Academica en la matriz de Roles y Permisos (lo mismo que
-- hace sync-modules-roles.mjs). El permiso de LIDER_ACADEMICA y ACADEMICA se da
-- SOLO al crear la opcion: si despues un admin lo quita en la matriz, un
-- reinicio no debe volver a darlo.
WITH nuevas AS (
  INSERT INTO public.submodules (module_id, code, name, sort_order, active)
  SELECT m.module_id, v.code, v.name,
         COALESCE((SELECT MAX(s.sort_order) FROM public.submodules s WHERE s.module_id = m.module_id), 0) + v.n, 'Y'
    FROM public.modules m
   CROSS JOIN (VALUES (1, 'MEMBRESIAS', 'Membresias Vigentes'),
                      (2, 'SEGUIMIENTO_ALUMNO', 'Seguimiento al Alumno')) AS v(n, code, name)
   WHERE m.code = 'ACADEMICA'
  ON CONFLICT (module_id, code) DO NOTHING
  RETURNING submodule_id, code
)
INSERT INTO public.rol_submodule_permission (rol_id, submodule_id, can_access, assigned_at)
SELECT r.rol_id, n.submodule_id, TRUE, now()
  FROM nuevas n
  JOIN public.rol r ON r.alias IN ('LIDER_ACADEMICA', 'ACADEMICA')
ON CONFLICT (rol_id, submodule_id) DO NOTHING;
`

export async function ensureStartupSchema () {
  await pool.query(SQL)
}
