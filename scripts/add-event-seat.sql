-- ============================================================================
-- Asiento asignado de la entrada VIP de un evento/congreso
--
-- Cada entrada VIP tiene un asiento numerado. Se carga al inscribir (Comercial,
-- Fundacion y FICO directo) y sale en el correo de confirmacion, que es lo que
-- la persona muestra al llegar.
--
-- text y no integer: los asientos reales vienen como "A-12", "Mesa 3", "B7".
-- Guardar el numero pelado obligaria a inventar un formato que la sala no usa.
--
-- Reemplaza a event_attendees (columna creada por error el mismo dia, vacia,
-- nunca leida por el backend desplegado).
--
-- Idempotente y re-ejecutable.
-- Correr sobre el tunel:  psql -h 127.0.0.1 -p 55432 -U postgres -d neondb -f add-event-seat.sql
-- ============================================================================

ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS event_seat text;

COMMENT ON COLUMN public.enrollments.event_seat IS
  'Asiento asignado de la entrada VIP. Sale en el correo de confirmacion del evento.';

ALTER TABLE public.enrollments
  DROP COLUMN IF EXISTS event_attendees;

-- ── VERIFICACION ───────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'enrollments' AND column_name IN ('event_seat', 'event_attendees');
