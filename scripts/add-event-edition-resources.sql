-- ============================================================================
-- Recursos por edicion de evento/congreso (banner, links y detalle de sesiones)
--
-- Alimenta la plantilla de correo confirmacion-evento.js: cada edicion guarda su
-- propio arte y sus formularios, y dos textos de detalle de sesiones (uno para
-- entradas VIRTUAL, otro para las presenciales VIP/GENERAL/PREMIUM).
--
-- Complementa a add-event-category.sql, que ya creo el catalogo
-- we_event_category y la columna enrollments.cat_event_category.
--
-- Idempotente y re-ejecutable: se puede correr varias veces sin duplicar nada.
-- Correr sobre el tunel:
--   psql -h 127.0.0.1 -p 55432 -U postgres -d neondb -f add-event-edition-resources.sql
--
-- Al terminar imprime cuatro verificaciones. LEERLAS TODAS: las dos de
-- pg_get_functiondef revelan el cuerpo de stored procedures que no estan
-- versionados en el repo, y de eso depende una decision del plan.
-- ============================================================================

BEGIN;

-- ── 1. Columnas nuevas en program_editions ─────────────────────────────────
-- Todas nullable: las ediciones que no son evento se quedan en NULL y el
-- correo cae al banner del programa (programs.banner_link).
-- whatsapp_link NO se agrega: ya existe y se reutiliza para el tercer boton.
ALTER TABLE public.program_editions
  ADD COLUMN IF NOT EXISTS banner_image           bytea,
  ADD COLUMN IF NOT EXISTS banner_mime            text,
  ADD COLUMN IF NOT EXISTS banner_link            text,
  ADD COLUMN IF NOT EXISTS certificate_form_link  text,
  ADD COLUMN IF NOT EXISTS business_card_link     text,
  ADD COLUMN IF NOT EXISTS session_detail_virtual text,
  ADD COLUMN IF NOT EXISTS session_detail_onsite  text;

COMMENT ON COLUMN public.program_editions.banner_image IS
  'Bytes del banner del correo. Va incrustado en el correo como adjunto CID, asi no depende de hosting publico ni sobrevive a redeploys del contenedor.';
COMMENT ON COLUMN public.program_editions.banner_mime IS
  'Content-Type de banner_image (image/jpeg o image/png).';
COMMENT ON COLUMN public.program_editions.banner_link IS
  'Banner por URL. Alternativa a banner_image para pegar un link externo. Precedencia: banner_image > banner_link > programs.banner_link.';
COMMENT ON COLUMN public.program_editions.certificate_form_link IS
  'Formulario de datos para el certificado (boton del correo de evento).';
COMMENT ON COLUMN public.program_editions.business_card_link IS
  'Formulario de subida de tarjeta de presentacion (boton del correo de evento).';
COMMENT ON COLUMN public.program_editions.session_detail_virtual IS
  'Texto libre del detalle de sesiones para entradas VIRTUAL (Zoom). Multilinea.';
COMMENT ON COLUMN public.program_editions.session_detail_onsite IS
  'Texto libre del detalle de sesiones para entradas presenciales (sede y hora).';

COMMIT;

-- ── VERIFICACION 1: las 5 columnas nuevas + whatsapp_link ──────────────────
-- Deben salir 8 filas.
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'program_editions'
   AND column_name IN ('banner_image', 'banner_mime', 'banner_link',
                       'certificate_form_link', 'business_card_link',
                       'session_detail_virtual', 'session_detail_onsite', 'whatsapp_link')
 ORDER BY column_name;

-- ── VERIFICACION 2: cuerpo de sp_edition_update ────────────────────────────
-- El plan asume que este SP NO conoce las columnas nuevas y por eso los
-- recursos se guardan con un endpoint de SQL directo (/eventresourcessave).
-- Si resulta que mapea el JSON por nombre de columna, se puede simplificar.
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'sp_edition_update';

-- ── VERIFICACION 3: cuerpo de sp_edition_tree_get ──────────────────────────
-- Mismo motivo en lectura. Si hace SELECT pe.*, el endpoint
-- /eventresourcesget sobra y el modal podria leer de aqui.
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'sp_edition_tree_get';

-- ── VERIFICACION 4: existe el tipo de programa "evento" en el catalogo? ────
-- El correo detecta evento por DOS vias: enrollments.cat_event_category (que ya
-- existe seguro) O el alias del tipo de programa. Si aqui NO aparece
-- 'we_program_type_event', no pasa nada: la primera via sigue funcionando.
-- Para agregarlo, descomentar el INSERT de mas abajo.
SELECT catalog_id, alias, description
  FROM public.catalog
 WHERE alias LIKE 'we_program_type%'
 ORDER BY alias;

-- ── OPCIONAL: crear el tipo de programa "evento" ───────────────────────────
-- Solo si la VERIFICACION 4 no lo devolvio. Mismo patron que add-event-category.sql.
--
-- INSERT INTO public.catalog (alias, description, catalog_parent_id, active)
-- SELECT 'we_program_type_event', 'Evento / Congreso', p.catalog_id, 'Y'
-- FROM public.catalog p
-- WHERE p.alias = 'we_program_type'
--   AND NOT EXISTS (SELECT 1 FROM public.catalog c WHERE c.alias = 'we_program_type_event');

-- ── CARGA DE RECURSOS DE UNA EDICION (ejemplo) ─────────────────────────────
-- Mientras no exista la pantalla en Producto, los recursos se cargan asi.
-- Reemplazar la abreviatura, la fecha de inicio y los valores.
--
-- UPDATE public.program_editions pe
--    SET banner_link            = 'https://REEMPLAZAR/banner.jpg',
--        certificate_form_link  = 'https://forms.gle/REEMPLAZAR',
--        business_card_link     = 'https://forms.gle/REEMPLAZAR',
--        whatsapp_link          = 'https://chat.whatsapp.com/REEMPLAZAR',
--        session_detail_virtual = E'Dia 1: Viernes 19 de Junio de 5pm a 9:20pm - Via Zoom (Hora Peru)\nDia 2: Sabado 20 de Junio de 9am a 1pm - Via Zoom (Hora Peru)',
--        session_detail_onsite  = E'Dia 1: Viernes 19 de Junio de 5pm a 9:20pm - Hotel Marriott, Miraflores\nDia 2: Sabado 20 de Junio de 9am a 1pm - Hotel Marriott, Miraflores'
--   FROM public.program_versions pv
--  WHERE pv.program_version_id = pe.program_version_id
--    AND UPPER(TRIM(pv.abbreviation)) = UPPER(TRIM('REEMPLAZAR-ABREVIATURA'))
--    AND pe.start_date::date = '2026-06-19';
