-- Modulo Tickets: soporte interno del ERP.
--
-- Migrado desde el sistema independiente Sistema-Tickets (Express + Prisma). Las
-- cinco tablas son nuevas y su DDL vive versionado aca, por eso el modulo usa
-- SQL plano y no stored procedures (mismo criterio que reprogram_cases).
--
-- Dos decisiones que se leen mal si no se explican:
--
--   1. ticket_id ES el correlativo visible. El sistema origen tenia una columna
--      "numero" con un trigger MAX(numero)+1, que serializa todas las altas. El
--      serial de Postgres da lo mismo sin lock; el formato "00042" lo pone la
--      entity (formatTicketCode). Ambos dejan huecos al hacer rollback, asi que
--      no se pierde ninguna garantia real.
--
--   2. Los relojes del SLA se CONGELAN al crear el ticket: *_due_at se calcula
--      con la politica vigente en ese instante y no se recalcula nunca mas. Si
--      manana el ADMIN cambia los plazos, los compromisos ya adquiridos siguen
--      siendo los que se le prometieron a quien reporto.
--
-- Idempotente: se puede correr varias veces.

-- ── Tickets ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tickets (
  ticket_id                serial PRIMARY KEY,
  title                    varchar(120) NOT NULL,
  problem                  text         NOT NULL,
  link                     varchar(2048),
  -- La clasifica el sistema (criterios-prioridad.md); quien reporta no la elige,
  -- para que nadie pueda inflar su propio ticket a ALTA.
  priority                 varchar(5)   NOT NULL DEFAULT 'MEDIA',
  status                   varchar(12)  NOT NULL DEFAULT 'ABIERTO',
  created_by_id            integer      NOT NULL REFERENCES public.users(user_id),
  assigned_to_id           integer      REFERENCES public.users(user_id),
  -- Compromisos congelados al crear.
  first_response_due_at    timestamp with time zone,
  resolution_due_at        timestamp with time zone,
  -- Cumplimiento real. Los sella la transicion de estado, una sola vez.
  first_response_at        timestamp with time zone,
  resolved_at              timestamp with time zone,
  -- Idempotencia del cron: un aviso por ticket y por reloj, nunca dos.
  response_alert_sent_at   timestamp with time zone,
  resolution_alert_sent_at timestamp with time zone,
  -- Escalamiento automatico: una sola vez por ticket; escalated_at es el guard.
  escalated_at             timestamp with time zone,
  escalated_from_id        integer REFERENCES public.users(user_id),
  -- Hilo de seguimiento en Slack. Solo lo tienen los tickets nacidos de /ticket.
  slack_channel_id         varchar(32),
  slack_message_ts         varchar(32),
  active                   char(1) NOT NULL DEFAULT 'Y',
  registration_date        timestamp with time zone NOT NULL DEFAULT now(),
  modification_date        timestamp with time zone,
  user_registration_id     integer,
  CONSTRAINT tickets_priority_chk CHECK (priority IN ('ALTA', 'MEDIA', 'BAJA')),
  CONSTRAINT tickets_status_chk   CHECK (status IN ('ABIERTO', 'EN_PROGRESO', 'CERRADO')),
  -- El flujo es irreversible (ABIERTO -> EN_PROGRESO -> CERRADO), asi que un
  -- ticket cerrado tiene forzosamente las dos marcas puestas.
  CONSTRAINT tickets_closed_chk CHECK (
    status <> 'CERRADO' OR (first_response_at IS NOT NULL AND resolved_at IS NOT NULL))
);

COMMENT ON TABLE public.tickets IS
  'Soporte interno: incidencias que reporta cualquier empleado y atiende un ADMIN. El area de un ticket se deriva del rol de quien lo creo, no se guarda.';
COMMENT ON COLUMN public.tickets.ticket_id IS
  'PK y correlativo visible a la vez. La entity lo formatea a 5 digitos ("00042").';
COMMENT ON COLUMN public.tickets.registration_date IS
  'Instante de creacion y origen de AMBOS relojes del SLA: el de resolucion mide la espera total de quien reporto, no el trabajo del agente desde que lo tomo.';
COMMENT ON COLUMN public.tickets.priority IS
  'ALTA = fallas del ERP. MEDIA = herramientas de oficina sin solucion conocida. BAJA = mejoras e instalaciones. La clasifica criterios-prioridad.md.';

CREATE INDEX IF NOT EXISTS tickets_created_by_idx
  ON public.tickets (created_by_id, ticket_id DESC) WHERE active = 'Y';
CREATE INDEX IF NOT EXISTS tickets_assigned_to_idx
  ON public.tickets (assigned_to_id) WHERE active = 'Y';
CREATE INDEX IF NOT EXISTS tickets_status_idx
  ON public.tickets (status, ticket_id DESC) WHERE active = 'Y';

-- Colas del cron. Indices parciales: cada uno cubre exactamente las filas que
-- ese barrido puede llegar a tocar, que son pocas frente al historico.
CREATE INDEX IF NOT EXISTS tickets_escalation_idx
  ON public.tickets (first_response_due_at)
  WHERE status = 'ABIERTO' AND escalated_at IS NULL;
CREATE INDEX IF NOT EXISTS tickets_alert_response_idx
  ON public.tickets (first_response_due_at)
  WHERE first_response_at IS NULL AND response_alert_sent_at IS NULL;
CREATE INDEX IF NOT EXISTS tickets_alert_resolution_idx
  ON public.tickets (resolution_due_at)
  WHERE resolved_at IS NULL AND resolution_alert_sent_at IS NULL;

-- ── Comentarios ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ticket_comments (
  ticket_comment_id    serial PRIMARY KEY,
  ticket_id            integer NOT NULL REFERENCES public.tickets(ticket_id) ON DELETE CASCADE,
  author_id            integer NOT NULL REFERENCES public.users(user_id),
  body                 text    NOT NULL,
  active               char(1) NOT NULL DEFAULT 'Y',
  registration_date    timestamp with time zone NOT NULL DEFAULT now(),
  modification_date    timestamp with time zone,
  user_registration_id integer
);

CREATE INDEX IF NOT EXISTS ticket_comments_ticket_idx
  ON public.ticket_comments (ticket_id, ticket_comment_id) WHERE active = 'Y';

COMMENT ON TABLE public.ticket_comments IS
  'Hilo del ticket. Lo ven quien reporto, el agente asignado y el lider del area de quien reporto.';

-- ── Adjuntos ───────────────────────────────────────────────────────────────
--
-- stored_name es un UUID; el nombre original NUNCA toca el filesystem (evita
-- path traversal y colisiones) y solo se usa en el Content-Disposition de la
-- descarga. Los archivos viven en coreWE/uploads/tickets.
--
-- Dos tablas y no una generalizada: un adjunto de ticket y uno de comentario
-- cuelgan de padres distintos y el ON DELETE CASCADE tiene que ser distinto.
CREATE TABLE IF NOT EXISTS public.ticket_attachments (
  ticket_attachment_id serial PRIMARY KEY,
  ticket_id            integer      NOT NULL REFERENCES public.tickets(ticket_id) ON DELETE CASCADE,
  original_name        varchar(255) NOT NULL,
  stored_name          varchar(64)  NOT NULL UNIQUE,
  mime_type            varchar(100) NOT NULL,
  size_bytes           integer      NOT NULL,
  active               char(1) NOT NULL DEFAULT 'Y',
  registration_date    timestamp with time zone NOT NULL DEFAULT now(),
  user_registration_id integer,
  CONSTRAINT ticket_attachments_mime_chk
    CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  CONSTRAINT ticket_attachments_size_chk
    CHECK (size_bytes > 0 AND size_bytes <= 5242880)
);

CREATE INDEX IF NOT EXISTS ticket_attachments_ticket_idx
  ON public.ticket_attachments (ticket_id) WHERE active = 'Y';

CREATE TABLE IF NOT EXISTS public.ticket_comment_attachments (
  ticket_comment_attachment_id serial PRIMARY KEY,
  ticket_comment_id            integer      NOT NULL REFERENCES public.ticket_comments(ticket_comment_id) ON DELETE CASCADE,
  original_name                varchar(255) NOT NULL,
  stored_name                  varchar(64)  NOT NULL UNIQUE,
  mime_type                    varchar(100) NOT NULL,
  size_bytes                   integer      NOT NULL,
  active                       char(1) NOT NULL DEFAULT 'Y',
  registration_date            timestamp with time zone NOT NULL DEFAULT now(),
  user_registration_id         integer,
  CONSTRAINT ticket_comment_attachments_mime_chk
    CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  CONSTRAINT ticket_comment_attachments_size_chk
    CHECK (size_bytes > 0 AND size_bytes <= 5242880)
);

CREATE INDEX IF NOT EXISTS ticket_comment_attachments_comment_idx
  ON public.ticket_comment_attachments (ticket_comment_id) WHERE active = 'Y';

-- ── Politicas de SLA ───────────────────────────────────────────────────────
--
-- PK = prioridad: tres filas fijas, sin historico. Lo que importa conservar son
-- los *_due_at ya congelados en cada ticket, no como estaba la politica ayer.
--
-- Minutos CORRIDOS: el reloj no se detiene fuera del horario laboral. Es la
-- regla del sistema origen y la que entiende quien reporta ("me respondieron
-- en 3 horas"), aunque castigue los tickets creados a las 6 p.m.
CREATE TABLE IF NOT EXISTS public.ticket_sla_policies (
  priority               varchar(5) PRIMARY KEY,
  first_response_minutes integer NOT NULL,
  resolution_minutes     integer NOT NULL,
  modification_date      timestamp with time zone NOT NULL DEFAULT now(),
  updated_by_id          integer REFERENCES public.users(user_id),
  CONSTRAINT ticket_sla_policies_priority_chk CHECK (priority IN ('ALTA', 'MEDIA', 'BAJA')),
  -- 1 min a 30 dias. Mas alla deja de ser un compromiso de servicio y casi
  -- siempre es un error de tipeo en el formulario.
  CONSTRAINT ticket_sla_policies_minutes_chk CHECK (
    first_response_minutes BETWEEN 1 AND 43200
    AND resolution_minutes BETWEEN 1 AND 43200
    AND resolution_minutes >= first_response_minutes)
);

INSERT INTO public.ticket_sla_policies (priority, first_response_minutes, resolution_minutes)
VALUES ('ALTA', 60, 480), ('MEDIA', 240, 1440), ('BAJA', 480, 4320)
ON CONFLICT (priority) DO NOTHING;

COMMENT ON TABLE public.ticket_sla_policies IS
  'Plazos por prioridad, en minutos corridos. Editables desde la pestana "Politicas SLA" de /tickets (solo ADMIN). Cambiarlos no reescribe compromisos ya adquiridos.';
