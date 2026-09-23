-- IA local (Ollama) en el ERP: las tres tablas donde se guarda lo que el modelo
-- redacta. El modelo es lento en CPU (~5 tokens/s), asi que TODO se precalcula
-- o se genera en segundo plano y la pantalla solo lee de aqui.
--
--   ai_daily_plans     Plan del dia por area (Comercial por asesor + fila de
--                      equipo; FICO/Academica/Producto una fila por area).
--   ai_lead_summaries  Resumen del historial de contacto de un lead.
--   ai_ticket_notes    Resumen, datos faltantes y borrador de respuesta de un ticket.
--
-- Idempotente: se puede correr varias veces. Reemplaza a ddl-ai-daily-plans.sql
-- (misma definicion de ai_daily_plans).

CREATE TABLE IF NOT EXISTS public.ai_daily_plans (
  ai_daily_plan_id  serial PRIMARY KEY,
  plan_date         date NOT NULL,
  area              varchar(20) NOT NULL,
  -- NULL = fila del equipo/area (la que lee el lider; en areas sin reparto por
  -- persona es tambien la que lee el colaborador).
  user_id           integer REFERENCES public.users(user_id),
  payload           jsonb NOT NULL,
  model             varchar(60),
  generated_at      timestamp NOT NULL DEFAULT LOCALTIMESTAMP
);

-- Regenerar el mismo dia reemplaza la fila (upsert), nunca duplica.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_daily_plans_dia
  ON public.ai_daily_plans (plan_date, area, COALESCE(user_id, 0));

-- fingerprint = huella de los intentos cuando se genero: si cambia, el resumen
-- esta viejo y se rehace al abrir la ficha.
CREATE TABLE IF NOT EXISTS public.ai_lead_summaries (
  lead_id       integer PRIMARY KEY REFERENCES public.leads(lead_id) ON DELETE CASCADE,
  fingerprint   varchar(120) NOT NULL,
  payload       jsonb NOT NULL,        -- { resumen, siguiente_paso }
  model         varchar(60),
  generated_at  timestamp NOT NULL DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.ai_ticket_notes (
  ticket_id     integer PRIMARY KEY REFERENCES public.tickets(ticket_id) ON DELETE CASCADE,
  fingerprint   varchar(120) NOT NULL,
  payload       jsonb NOT NULL,        -- { resumen, falta[], respuesta_sugerida }
  model         varchar(60),
  generated_at  timestamp NOT NULL DEFAULT LOCALTIMESTAMP
);
