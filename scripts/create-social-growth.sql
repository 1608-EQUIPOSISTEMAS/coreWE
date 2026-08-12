-- Crecimiento en redes sociales (modulo Marketing -> Crecimiento RRSS).
-- Reemplaza el Google Sheet "REPORTE CRECIMIENTO DE RRSS".
--
-- Idempotente: correrlo N veces deja el mismo estado. Lo aplica
-- scripts/seed-social-accounts.mjs antes de sembrar el catalogo.

-- Toda cosa cuyo numero de seguidores medimos. Un grupo de Facebook y una linea
-- de WhatsApp son cuentas igual que una fan page: lo unico que cambia es que
-- nadie las puede leer por API (external_id NULL) y se cargan a mano.
CREATE TABLE IF NOT EXISTS public.social_accounts (
  account_id   serial PRIMARY KEY,
  brand        text NOT NULL,
  network      text NOT NULL,
  display_name text NOT NULL,
  external_id  text,
  active       char(1) NOT NULL DEFAULT 'Y',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_accounts_unq UNIQUE (brand, network, display_name)
);

-- Un snapshot por cuenta y semana. NO se guarda el crecimiento: se deriva de dos
-- snapshots consecutivos (buildGrowthSeries en growth.entity.js). En la hoja el
-- delta vivia como celda aparte del acumulado y por eso se desincronizaba.
--
-- La PK compuesta da la idempotencia: el cron corre a diario y hace upsert sobre
-- la fila de la semana en curso, asi que reintentarlo no duplica nada y un dia
-- caido se auto-repara al siguiente.
CREATE TABLE IF NOT EXISTS public.social_follower_snapshots (
  account_id  int  NOT NULL REFERENCES public.social_accounts(account_id),
  week_start  date NOT NULL,
  followers   int  NOT NULL CHECK (followers >= 0),
  source      text NOT NULL CHECK (source IN ('API', 'MANUAL')),
  captured_at timestamptz NOT NULL DEFAULT now(),
  captured_by text,
  PRIMARY KEY (account_id, week_start)
);

-- La vista siempre pide un rango de semanas para todas las cuentas a la vez.
CREATE INDEX IF NOT EXISTS social_follower_snapshots_week_idx
  ON public.social_follower_snapshots (week_start);
