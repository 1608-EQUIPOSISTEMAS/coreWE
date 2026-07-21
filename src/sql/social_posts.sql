-- ============================================================
-- Módulo Marketing · Publicaciones RRSS (IG / LinkedIn).
-- Una fila por publicación, programada o detectada.
--   status: PROGRAMADO      -> agendada, aún no publicada
--           PUBLICADO       -> publicada (match con programación o confirmada)
--           NO_PROGRAMADO   -> salió publicada sin programación previa
--           CANCELADO       -> programación descartada
--   source: MANUAL (la creó un usuario) | AUTO (la detectó el sync de APIs)
-- DDL 100% aditivo (idempotente).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.social_posts (
  post_id      SERIAL PRIMARY KEY,
  network      VARCHAR(10)  NOT NULL CHECK (network IN ('IG','LINKEDIN')),
  account_name VARCHAR(150),
  external_id  TEXT UNIQUE,          -- id del post en la API (NULL si aún no publicado)
  caption      TEXT,
  permalink    TEXT,
  media_type   VARCHAR(30),
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  status       VARCHAR(15) NOT NULL DEFAULT 'PROGRAMADO'
               CHECK (status IN ('PROGRAMADO','PUBLICADO','NO_PROGRAMADO','CANCELADO')),
  source       VARCHAR(10) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','AUTO')),
  confirmed    CHAR(1)     NOT NULL DEFAULT 'N',   -- visto/confirmado por marketing
  notes        TEXT,
  created_by   VARCHAR(120),
  active       CHAR(1)     NOT NULL DEFAULT 'Y',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_periodo
  ON public.social_posts (COALESCE(published_at, scheduled_at));

-- Submódulo para Configuración → Roles y Permisos
INSERT INTO public.submodules (module_id, code, name, route, sort_order)
SELECT m.module_id, 'PUBLICACIONES', 'Publicaciones RRSS', '/marketing/publicaciones', 2
FROM public.modules m
WHERE m.code = 'MARKETING'
ON CONFLICT (module_id, code) DO NOTHING;
