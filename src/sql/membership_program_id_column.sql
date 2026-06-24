-- =====================================================================
-- MEMBERSHIP TIER NORMALIZADO EN COLUMNA (reemplaza el hack de notes)
-- =====================================================================
-- El tier de membresia (WE PLUS/GOLD/PLAT/BLACK) se estampaba en texto
-- libre en enrollments.notes y se recuperaba con un regex en el frontend.
-- Fragil: el campo notes lo pisa cualquier observacion del asesor (ver
-- inscripcion 4573, que quedo sin tier). Lo normalizamos como FK a la
-- fila real de la membresia, que ya existe en programs (is_membership='Y'):
--   167 MEMBRESIA BLACK | 168 MEMBRESIA PLUS | 169 GOLDEN | 170 PLATINIUM
--
-- NULL = la inscripcion no tiene membresia asociada (caso normal). La
-- columna es nullable a proposito para no afectar el alta normal ni otros
-- endpoints que insertan/leen enrollments.
-- =====================================================================

ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS membership_program_id INTEGER
    REFERENCES public.programs(program_id);

COMMENT ON COLUMN public.enrollments.membership_program_id IS
  'Membresia (programs.is_membership=Y) que otorga el beneficio en esta inscripcion. NULL = sin membresia. Reemplaza el prefijo "Beneficio de membresia ..." que antes vivia en notes.';

CREATE INDEX IF NOT EXISTS idx_enrollments_membership_program
  ON public.enrollments(membership_program_id)
  WHERE membership_program_id IS NOT NULL;
