-- Tipo de pago "Pago de Certificado" (grupo we_payment_type, id 3112).
-- Lo usa el pago adicional de becados (POST /fico/additionalpayment): fila en
-- payments SIN cuota asociada (installment_id NULL) que habilita la etiqueta
-- Certificar (enrollments.cat_certificate_status -> we_certificate_status_paid).
-- Idempotente: solo inserta si el alias no existe.
INSERT INTO public.catalog (catalog_parent_id, description, alias, active, registration_date)
SELECT 3112, 'Pago de Certificado', 'we_payment_type_certificate', 'Y', NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM public.catalog WHERE alias = 'we_payment_type_certificate'
);

-- El pago de certificado es un pago SUELTO (no pertenece al plan de cuotas):
-- installment_id debe aceptar NULL. Todo el resto del sistema siempre inserta
-- payments con cuota, asi que quitar el NOT NULL no cambia ningun flujo previo.
ALTER TABLE public.payments ALTER COLUMN installment_id DROP NOT NULL;
