-- Backfill: restaura el marcador 'Importacion masiva FICO (hoja)' en enrollments
-- cuyo notes fue borrado por el bug de "Editar datos" (el modal re-enviaba
-- notes=null porque sp_fico_payment_detail_get no devuelve notes, y
-- enrollmentUpdate lo escribia tal cual). Sin el marcador, EXCLUDE_IMPORTED
-- deja pasar la inscripcion al sync de Google Sheets y aparece como venta.
--
-- Identificacion: editadas con justificacion 'AJUSTE IMPORTACION...', notes NULL
-- y SIN lead (las importaciones no tienen fila en leads; las ventas reales si).
-- Idempotente: re-ejecutar mientras la campana de ediciones siga corriendo con
-- el backend viejo. Obsoleto cuando termine la migracion (ver EXCLUDE_IMPORTED).
WITH editadas AS (
  SELECT DISTINCT al.enrollment_id
  FROM enrollment_audit_log al
  WHERE al.action = 'edited' AND al.justificacion ILIKE '%AJUSTE IMPORTACI%'
)
UPDATE enrollments e
   SET notes = 'Importacion masiva FICO (hoja)',
       user_modification_id = 9,
       modification_date = NOW()
  FROM editadas ed
 WHERE e.enrollment_id = ed.enrollment_id
   AND e.notes IS NULL
   AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.enrollment_id = e.enrollment_id);
