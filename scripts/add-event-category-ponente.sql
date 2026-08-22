-- ============================================================================
-- Quinta categoria de entrada: PONENTE (expositores del congreso)
--
-- El ponente se inscribe como cualquier asistente (para que exista en el
-- listado, en el aula y en la hoja "4. Ventas Eventos") pero no compra
-- entrada: se le carga tarifa 0 y se sienta en la zona VIP.
--
-- No hace falta nada mas que esta fila: Fundacion -> Eventos ya dibuja TODAS
-- las categorias del catalogo, y FICO ya ofrece las que esten encendidas.
--
-- DESPUES DE CORRER ESTO, por cada congreso:
--   Fundacion -> Eventos -> Categorias de entrada -> encender PONENTE con los
--   cuatro precios en 0 y (si se quiere) el mismo grupo de WhatsApp del VIP.
--
-- Idempotente y re-ejecutable.
--   psql -h 127.0.0.1 -p 5433 -U postgres -d system_erp_dev -f add-event-category-ponente.sql
-- ============================================================================

INSERT INTO public.catalog (alias, description, catalog_parent_id, active)
SELECT 'we_event_category_ponente', 'PONENTE', p.catalog_id, 'Y'
FROM public.catalog p
WHERE p.alias = 'we_event_category'
  AND NOT EXISTS (
    SELECT 1 FROM public.catalog c WHERE c.alias = 'we_event_category_ponente'
  );

-- ── VERIFICACION: deben salir las cinco categorias ─────────────────────────
SELECT c.catalog_id, c.alias, c.description, c.active
FROM public.catalog c
JOIN public.catalog p ON p.catalog_id = c.catalog_parent_id
WHERE p.alias = 'we_event_category'
ORDER BY c.description;
