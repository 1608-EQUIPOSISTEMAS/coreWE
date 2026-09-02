-- El trigger congela el lead despues de la venta, pero FICO corrige datos de
-- contacto del alumno desde "Editar Alumno" (con justificacion y bitacora) y ese
-- flujo escribe leads.origin_email / origin_phone: la excepcion salia a pantalla
-- como "Internal Server Error" (caso enrollment 18233, 02/09/26).
--
-- Se amplia la lista blanca que ya existia para pay_date. Todo lo demas del lead
-- (programa, monto, asesor) sigue congelado tras la venta.
CREATE OR REPLACE FUNCTION public.trg_block_update_if_enrolled()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.enrollment_id IS NOT NULL THEN
        -- FICO corrige la fecha de pago del lead ya vendido: leads.pay_date es
        -- la que manda en la columna F. PAGO de las hojas, asi que el sync de
        -- confirmPayment tiene que poder escribirla. El correo y el telefono los
        -- corrige "Editar Alumno" de FICO. Todo lo demas del lead sigue
        -- congelado despues de la venta.
        IF to_jsonb(NEW) - 'pay_date' - 'origin_email' - 'origin_phone' - 'user_modification_id'
         = to_jsonb(OLD) - 'pay_date' - 'origin_email' - 'origin_phone' - 'user_modification_id' THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION
            'No se puede modificar el lead % porque ya tiene enrollment_id (%).',
            OLD.lead_id,
            OLD.enrollment_id;
    END IF;

    RETURN NEW;
END;
$$;
