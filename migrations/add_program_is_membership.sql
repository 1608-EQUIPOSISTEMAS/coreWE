-- Agrega columna explicita programs.is_membership para clasificar programas
-- como membresia, en lugar de depender de heuristica string-based en codigo.
-- Idempotente.

BEGIN;

ALTER TABLE public.programs
    ADD COLUMN IF NOT EXISTS is_membership boolean NOT NULL DEFAULT false;

-- Backfill: aplicar la heuristica actual una vez para clasificar lo existente.
-- Match: abbreviation o nombre contienen MEMB / PLUS / PLAT / BLACK / GOLD.
UPDATE public.programs p
   SET is_membership = true
  FROM public.program_versions pv
 WHERE pv.program_id = p.program_id
   AND p.is_membership = false
   AND (
        UPPER(COALESCE(pv.abbreviation, '')) LIKE '%MEMB%'
     OR UPPER(COALESCE(pv.abbreviation, '')) LIKE '%PLUS%'
     OR UPPER(COALESCE(pv.abbreviation, '')) LIKE '%PLAT%'
     OR UPPER(COALESCE(pv.abbreviation, '')) LIKE '%BLACK%'
     OR UPPER(COALESCE(pv.abbreviation, '')) LIKE '%GOLD%'
   );

COMMIT;

-- Verificacion (descomentar para correr):
-- SELECT p.program_id, pv.abbreviation, p.is_membership
--   FROM public.programs p
--   LEFT JOIN public.program_versions pv ON pv.program_id = p.program_id
--  WHERE p.is_membership = true
--  ORDER BY p.program_id;
