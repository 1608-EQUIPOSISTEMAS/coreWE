-- Borrar una venta tiene que poder liberar a su lead.
--
-- deleteEnrollmentCascade (enrollment.repository.js) desengancha el lead con
-- UPDATE leads SET enrollment_id = NULL antes de borrar el enrollment, porque
-- el FK leads.enrollment_id es ON DELETE NO ACTION. El candado rechazaba ese
-- UPDATE y tumbaba la transaccion entera: el boton "Eliminar" del ERP no
-- borraba nada y tampoco dejaba rastro, porque el ROLLBACK revertia los DELETE
-- previos. Solo fallaba con ventas nacidas de un lead.
--
-- Soltar el enrollment_id es exactamente lo contrario a "modificar un lead ya
-- vendido": la venta deja de existir, asi que el candado ya no tiene nada que
-- proteger. Ningun otro flujo escribe NULL ahi (el unico UPDATE que lo hace es
-- el de la cascada de borrado), asi que esto no abre una puerta de escape.
CREATE OR REPLACE FUNCTION public.trg_block_update_if_enrolled()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF OLD.enrollment_id IS NOT NULL THEN
        -- La venta se esta borrando y el lead vuelve a quedar libre.
        IF NEW.enrollment_id IS NULL THEN
            RETURN NEW;
        END IF;

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
$function$;
