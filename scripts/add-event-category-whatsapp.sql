-- ============================================================================
-- Grupo de WhatsApp por categoria de entrada
--
-- Cada categoria de un congreso tiene su propio grupo (los VIP no van al mismo
-- grupo que los VIRTUAL), asi que el link deja de ser uno por edicion y pasa a
-- ser uno por (version de programa, categoria) -- la misma llave que ya usan
-- los precios.
--
-- Complementa a add-event-category.sql, que creo event_category_prices.
--
-- Idempotente y re-ejecutable. Correr sobre el tunel:
--   psql -h 127.0.0.1 -p 55432 -U postgres -d neondb -f add-event-category-whatsapp.sql
-- ============================================================================

BEGIN;

ALTER TABLE public.event_category_prices
  ADD COLUMN IF NOT EXISTS whatsapp_link text;

COMMENT ON COLUMN public.event_category_prices.whatsapp_link IS
  'Grupo de WhatsApp de esa categoria de entrada. El correo de confirmacion lo prefiere sobre program_editions.whatsapp_link.';

-- La fila EXISTE = esa categoria se vende en ese evento. No todos los congresos
-- tienen las cuatro: unos son VIP/PREMIUM/VIRTUAL y otros suman GENERAL. Por eso
-- no hay columna "enabled": alta = insert, baja = active='N'.
COMMENT ON TABLE public.event_category_prices IS
  'Categorias de entrada habilitadas por version de programa, con su tarifa y su grupo de WhatsApp. Si una version no tiene ninguna fila, se ofrecen las cuatro del catalogo.';

COMMIT;

-- ── VERIFICACION 1: la columna quedo ───────────────────────────────────────
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'event_category_prices'
 ORDER BY ordinal_position;

-- ── VERIFICACION 2: que eventos ya tienen categorias definidas ─────────────
-- Vacio es normal si todavia no se configuro ninguno desde Fundacion > Eventos.
SELECT pv.abbreviation,
       c.description AS categoria,
       p.price_student_soles,
       (p.whatsapp_link IS NOT NULL) AS tiene_whatsapp,
       p.active
  FROM public.event_category_prices p
  JOIN public.program_versions pv ON pv.program_version_id = p.program_version_id
  JOIN public.catalog c ON c.catalog_id = p.cat_event_category
 ORDER BY pv.abbreviation, c.description;
