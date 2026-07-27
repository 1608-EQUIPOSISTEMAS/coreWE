-- ============================================================================
-- Categoria de entrada para eventos/congresos (Fundacion)
--   VIP / GENERAL / PREMIUM / VIRTUAL, cada una con su propio precio.
--
-- Idempotente y re-ejecutable: se puede correr varias veces sin duplicar nada.
-- Correr sobre el tunel:  psql -h 127.0.0.1 -p 55432 -U postgres -d neondb -f add-event-category.sql
--
-- Al terminar imprime tres verificaciones. Si alguna sale vacia, avisar.
-- ============================================================================

BEGIN;

-- ── 1. Catalogo: tipo padre + 4 opciones ───────────────────────────────────
-- Sigue el patron parent/child del resto del catalogo (ver we_currency).
INSERT INTO public.catalog (alias, description, catalog_parent_id, active)
SELECT 'we_event_category', 'Categoria de entrada (evento)', NULL, 'Y'
WHERE NOT EXISTS (SELECT 1 FROM public.catalog WHERE alias = 'we_event_category');

INSERT INTO public.catalog (alias, description, catalog_parent_id, active)
SELECT v.alias, v.description, p.catalog_id, 'Y'
FROM (VALUES
  ('we_event_category_general', 'GENERAL'),
  ('we_event_category_premium', 'PREMIUM'),
  ('we_event_category_vip',     'VIP'),
  ('we_event_category_virtual', 'VIRTUAL')
) AS v(alias, description)
CROSS JOIN public.catalog p
WHERE p.alias = 'we_event_category'
  AND NOT EXISTS (SELECT 1 FROM public.catalog c WHERE c.alias = v.alias);

-- ── 2. Columna en enrollments ──────────────────────────────────────────────
-- Nullable a proposito: solo las inscripciones de evento la usan.
ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS cat_event_category integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'enrollments_cat_event_category_fkey'
  ) THEN
    ALTER TABLE public.enrollments
      ADD CONSTRAINT enrollments_cat_event_category_fkey
      FOREIGN KEY (cat_event_category) REFERENCES public.catalog (catalog_id);
  END IF;
END $$;

-- ── 3. Precios por (version de programa, categoria) ────────────────────────
-- Espeja las 4 tarifas que ya maneja program_versions: estudiante/profesional
-- x soles/dolares. Si una categoria no tiene fila, el form cae al precio del
-- programa (comportamiento actual).
CREATE TABLE IF NOT EXISTS public.event_category_prices (
  program_version_id        integer NOT NULL REFERENCES public.program_versions (program_version_id),
  cat_event_category        integer NOT NULL REFERENCES public.catalog (catalog_id),
  price_student_soles       numeric(12,2) NOT NULL DEFAULT 0,
  price_student_dollars     numeric(12,2) NOT NULL DEFAULT 0,
  price_profesional_soles   numeric(12,2) NOT NULL DEFAULT 0,
  price_profesional_dollars numeric(12,2) NOT NULL DEFAULT 0,
  active                    char(1) NOT NULL DEFAULT 'Y',
  registration_date         timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (program_version_id, cat_event_category)
);

CREATE INDEX IF NOT EXISTS idx_event_category_prices_version
  ON public.event_category_prices (program_version_id);

COMMIT;

-- ── VERIFICACION ───────────────────────────────────────────────────────────
-- 1) Las 4 categorias existen y cuelgan del padre correcto
SELECT c.catalog_id, c.alias, c.description
FROM public.catalog c
JOIN public.catalog p ON p.catalog_id = c.catalog_parent_id
WHERE p.alias = 'we_event_category'
ORDER BY c.description;

-- 2) La columna quedo en enrollments
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'enrollments' AND column_name = 'cat_event_category';

-- 3) La tabla de precios existe
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'event_category_prices'
ORDER BY ordinal_position;

-- ── CARGA DE PRECIOS (ejemplo) ─────────────────────────────────────────────
-- Mientras no exista pantalla en Producto, los precios se cargan asi.
-- Reemplazar la abreviatura y los montos. Re-ejecutable (ON CONFLICT).
--
-- INSERT INTO public.event_category_prices
--   (program_version_id, cat_event_category, price_student_soles, price_student_dollars,
--    price_profesional_soles, price_profesional_dollars)
-- SELECT pv.program_version_id, c.catalog_id, v.pen_est, v.usd_est, v.pen_pro, v.usd_pro
-- FROM public.program_versions pv
-- CROSS JOIN (VALUES
--   ('we_event_category_general',  300, 80,  350, 95),
--   ('we_event_category_premium',  600, 160, 700, 190),
--   ('we_event_category_vip',     1200, 320, 1400, 380),
--   ('we_event_category_virtual',  150, 40,  180, 50)
-- ) AS v(alias, pen_est, usd_est, pen_pro, usd_pro)
-- JOIN public.catalog c ON c.alias = v.alias
-- WHERE UPPER(TRIM(pv.abbreviation)) = UPPER(TRIM('REEMPLAZAR-ABREVIATURA'))
-- ON CONFLICT (program_version_id, cat_event_category) DO UPDATE
--   SET price_student_soles       = EXCLUDED.price_student_soles,
--       price_student_dollars     = EXCLUDED.price_student_dollars,
--       price_profesional_soles   = EXCLUDED.price_profesional_soles,
--       price_profesional_dollars = EXCLUDED.price_profesional_dollars;
