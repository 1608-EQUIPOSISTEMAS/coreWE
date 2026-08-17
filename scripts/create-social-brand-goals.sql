-- Objetivo anual de seguidores por marca (Crecimiento RRSS).
--
-- El módulo nació sin metas a propósito; se agregaron el 14/08/2026 a pedido.
--
-- `brand` es texto y no una FK: en este módulo la marca no es una entidad, es una
-- columna de social_accounts (no hay tabla `brands` en el ERP). Una marca que se
-- renombre deja su objetivo huérfano — es el mismo trato que ya reciben las
-- cuentas, y crear una tabla de marcas solo para esto sería inventar un maestro
-- que nadie más necesita.
--
-- El objetivo es "seguidores a alcanzar" (stock), no "crecimiento del año"
-- (flujo): se lee directo contra la última medición sin depender de que exista
-- una medición de enero, que hoy no está cargada para casi ninguna cuenta.
CREATE TABLE IF NOT EXISTS public.social_brand_goals (
  brand           text        NOT NULL,
  year            integer     NOT NULL,
  followers_goal  integer     NOT NULL CHECK (followers_goal > 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text,
  PRIMARY KEY (brand, year)
);

COMMENT ON TABLE public.social_brand_goals IS
  'Meta anual de seguidores por marca. followers_goal = total a alcanzar al 31/12, no el crecimiento del año.';
