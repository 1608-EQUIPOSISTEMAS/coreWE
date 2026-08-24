-- ============================================================================
-- Encender la categoria PONENTE en el V CONGRESO DE DIRECCION.
--
-- La fila del catalogo ya existe (add-event-category-ponente.sql). Sin esta
-- OTRA fila, la de precios, el combo de /fico/inscripciones/new no la ofrece:
-- program.repository.eventCategoryList devuelve todas las categorias solo
-- cuando el evento no tiene NINGUNA encendida; en cuanto hay una, filtra.
--
-- Los cuatro precios van en 0: el ponente no compra entrada. whatsapp_link
-- queda NULL porque su correo no lleva el boton de WhatsApp.
--
-- Idempotente y re-ejecutable.
-- ============================================================================

INSERT INTO public.event_category_prices
  (program_version_id, cat_event_category, active,
   price_student_soles, price_student_dollars,
   price_profesional_soles, price_profesional_dollars, whatsapp_link)
SELECT pv.program_version_id, c.catalog_id, 'Y', 0, 0, 0, 0, NULL
  FROM public.program_versions pv
  CROSS JOIN public.catalog c
 WHERE pv.program_version_id = 239
   AND c.alias = 'we_event_category_ponente'
ON CONFLICT (program_version_id, cat_event_category) DO UPDATE
  SET active = 'Y',
      price_student_soles       = 0,
      price_student_dollars     = 0,
      price_profesional_soles   = 0,
      price_profesional_dollars = 0;
