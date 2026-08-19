-- Modulo Reprogramaciones: bandeja de alumnos varados por una edicion cancelada (A5).
--
-- La bandeja NO se siembra: los afectados se derivan en vivo de las ediciones A5
-- (ver reprogramacion.repository.js). Esta tabla guarda solo el WORKFLOW de los
-- casos que alguien ya tomo. Sin fila = caso recien detectado, nadie lo toco.
--
-- Idempotente: se puede correr varias veces.

CREATE TABLE IF NOT EXISTS public.reprogram_cases (
  reprogram_case_id       serial PRIMARY KEY,
  -- La VENTA afectada (top-level). Los modulos hijos viajan con ella, no
  -- generan caso propio: un paquete con 5 modulos caidos es UN caso.
  enrollment_id           integer NOT NULL REFERENCES public.enrollments(enrollment_id),
  status                  varchar(12) NOT NULL DEFAULT 'propuesto',
  -- Destino que elige Academica. dest_kind lo decide la entity, no el usuario:
  -- mismo program_version que el origen => RP; distinto => Cambio de Curso.
  dest_program_version_id integer,
  dest_edition_id         integer,
  dest_kind               varchar(2),
  proposed_by             integer,
  proposed_at             timestamp with time zone,
  contacted_by            integer,
  contacted_at            timestamp with time zone,
  contact_notes           text,
  verdict_by              integer,
  verdict_at              timestamp with time zone,
  verdict_notes           text,
  -- Resultado de la ejecucion.
  new_enrollment_id       integer,
  -- Pasos que fallaron y hay que hacer a mano (tipicamente el unlink del aula
  -- vieja en Odoo, que falla por permisos). [] = todo salio bien.
  pending_steps           jsonb NOT NULL DEFAULT '[]'::jsonb,
  active                  char(1) NOT NULL DEFAULT 'Y',
  registration_date       timestamp with time zone NOT NULL DEFAULT now(),
  modification_date       timestamp with time zone,
  CONSTRAINT reprogram_cases_status_chk
    CHECK (status IN ('propuesto', 'contactado', 'aceptado', 'rechazado', 'cerrado')),
  CONSTRAINT reprogram_cases_kind_chk
    CHECK (dest_kind IS NULL OR dest_kind IN ('RP', 'CC'))
);

-- Un solo caso abierto por venta. Los cerrados historicos no estorban.
CREATE UNIQUE INDEX IF NOT EXISTS reprogram_cases_enrollment_uq
  ON public.reprogram_cases (enrollment_id) WHERE active = 'Y';

CREATE INDEX IF NOT EXISTS reprogram_cases_status_idx
  ON public.reprogram_cases (status) WHERE active = 'Y';

COMMENT ON TABLE public.reprogram_cases IS
  'Workflow del modulo Reprogramaciones: Academica propone destino, se contacta al alumno, FICO da el veredicto y se ejecuta el RP o el Cambio de Curso. La lista de afectados se deriva en vivo de las ediciones A5, no se guarda aca.';
COMMENT ON COLUMN public.reprogram_cases.enrollment_id IS
  'La venta afectada (top-level). Los modulos hijos no generan caso propio.';
COMMENT ON COLUMN public.reprogram_cases.dest_kind IS
  'RP = mismo program_version (reprogramEdition). CC = otro programa (courseChange). Lo deriva la entity.';
COMMENT ON COLUMN public.reprogram_cases.pending_steps IS
  'Pasos que fallaron al ejecutar y quedan manuales (ej. desinscribir del aula vieja en Odoo).';
