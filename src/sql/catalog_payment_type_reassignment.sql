-- Tipo de pago "Pago de Reasignacion" (grupo we_payment_type, id 3112).
-- Pago suelto (installment_id NULL) por el proceso de reasignacion de un curso
-- jalado dentro de un paquete: el hijo nuevo entra SEG pago-cero y el cobro del
-- proceso se registra con este tipo. El sync lo manda a la hoja "Adicionales"
-- con ASUNTO='REASIGNACIÓN' (ver getFicoAdicionales / buildAdicionalesRow).
-- Idempotente: solo inserta si el alias no existe. YA APLICADO en BD el 21/07/2026.
INSERT INTO public.catalog (catalog_parent_id, description, alias, active, registration_date)
SELECT 3112, 'Pago de Reasignacion', 'we_payment_type_reassignment', 'Y', NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM public.catalog WHERE alias = 'we_payment_type_reassignment'
);
