-- ============================================================================
-- public.fn_client_moment — E. CLIENTE (momento del cliente), regla unica
-- ============================================================================
-- Antes esta regla vivia inline dentro de sp_search_phone_get y solo miraba la
-- tabla `consolidated` (historico pre-ERP). Los 30k leads creados dentro del ERP
-- eran invisibles: quien consultaba por segunda vez seguia saliendo NUEVO.
-- 6,547 de 30,892 leads (21%) quedaron mal clasificados por eso.
--
-- Regla de negocio (acordada 2026-08-12):
--   COMUNIDAD  ya tenia una venta registrada ANTES de esta consulta
--   LEAD       ya habia consultado antes, sin venta previa
--   NUEVO      primera consulta de su vida
--
-- El momento describe QUE ERA la persona cuando levanto la mano, no que es hoy:
-- por eso todo se compara contra p_at y una venta posterior nunca reescribe una
-- consulta vieja.
--
-- EL VALOR CALCULADO ES UN PISO, NO UN VEREDICTO. El asesor puede subirlo (sabe
-- de una compra de 2023 que nunca se importo => COMUNIDAD) pero nunca bajarlo,
-- que es de donde venia el "sale NUEVO aunque ya haya consultado".
-- ============================================================================

-- El cruce es por telefono exacto y esta en el camino caliente (el asesor
-- presiona Enter y espera). leads.origin_phone ya tenia indice; estos dos no.
CREATE INDEX IF NOT EXISTS idx_consolidated_phone
  ON public.consolidated (phone);
CREATE INDEX IF NOT EXISTS idx_person_contacts_value
  ON public.person_contacts (value);


-- Orden del momento: NUEVO < LEAD < COMUNIDAD. Los catalog_id NO estan en ese
-- orden (3048 NUEVO, 3047 LEAD, 3049 COMUNIDAD), asi que el rango es explicito.
CREATE OR REPLACE FUNCTION public.fn_client_moment_rank(p_moment integer)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p_moment
    WHEN 3048 THEN 1   -- we_moment_new
    WHEN 3047 THEN 2   -- we_moment_lead
    WHEN 3049 THEN 3   -- we_moment_cwd
    ELSE 0             -- desconocido/NULL: nunca gana contra el calculado
  END
$$;

COMMENT ON FUNCTION public.fn_client_moment_rank(integer) IS
  'Orden NUEVO(1) < LEAD(2) < COMUNIDAD(3) para poder comparar dos momentos.';


CREATE OR REPLACE FUNCTION public.fn_client_moment(
  p_phone  varchar,
  p_chosen integer   DEFAULT NULL,          -- lo que eligio el asesor, si eligio algo
  p_at     timestamp DEFAULT LOCALTIMESTAMP -- fecha de la consulta que se clasifica
) RETURNS integer
LANGUAGE sql STABLE AS $$
  WITH piso AS (
    SELECT CASE
      -- ── COMUNIDAD: hay una venta anterior a esta consulta ──────────────────
      WHEN p_phone IS NULL OR p_phone = '' THEN 3048
      WHEN EXISTS (
             -- Por persona: alcanza a las ventas FICO importadas de la hoja, que
             -- no tienen lead. Es la mitad de las COMUNIDAD (4,635 telefonos con
             -- venta por persona vs 2,450 por lead).
             SELECT 1
               FROM public.enrollments e
               JOIN public.customers cu       ON cu.customer_id = e.customer_id
               JOIN public.person_contacts pc ON pc.person_id   = cu.person_id
               JOIN public."catalog" via      ON via.catalog_id = pc.cat_way_contact
                                             AND via.alias      = 'we_way_contact_phone'
              WHERE pc.value = p_phone
                AND e.active = 'Y'
                AND e.registration_date < p_at
           )
        OR EXISTS (
             -- Por lead: cubre a quien compro sin quedar enganchado a la persona.
             SELECT 1
               FROM public.leads l
               JOIN public.enrollments e ON e.enrollment_id = l.enrollment_id
              WHERE l.origin_phone = p_phone
                AND e.active = 'Y'
                AND e.registration_date < p_at
           )
        OR EXISTS (
             -- Legacy pre-ERP: la fila de `consolidated` ya venia marcada
             -- COMUNIDAD, o sea que en su dia ya se le conocia una compra.
             SELECT 1
               FROM public.consolidated c
              WHERE c.phone = p_phone
                AND c.cat_client_moment = 3049
                AND c.formateddate < p_at
           )
        THEN 3049

      -- ── LEAD: ya habia consultado antes, no importa con que asesor ─────────
      WHEN EXISTS (
             SELECT 1 FROM public.leads l
              WHERE l.origin_phone = p_phone
                AND l.registration_date < p_at
           )
        OR EXISTS (
             SELECT 1 FROM public.consolidated c
              WHERE c.phone = p_phone
                AND c.formateddate < p_at
           )
        THEN 3047

      -- ── NUEVO: no hay rastro ──────────────────────────────────────────────
      ELSE 3048
    END AS moment
  )
  -- El asesor solo puede subir el piso, nunca perforarlo.
  SELECT CASE
    WHEN public.fn_client_moment_rank(p_chosen) > public.fn_client_moment_rank(piso.moment)
      THEN p_chosen
    ELSE piso.moment
  END
  FROM piso
$$;

COMMENT ON FUNCTION public.fn_client_moment(varchar, integer, timestamp) IS
  'E. CLIENTE de un telefono a la fecha p_at: COMUNIDAD si ya tenia venta, LEAD '
  'si ya habia consultado, NUEVO si no hay rastro. p_chosen (lo que eligio el '
  'asesor) solo se respeta si es MAS alto que lo calculado.';
