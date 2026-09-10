-- El reenvio a FICO de una inscripcion OBSERVADA moria en el candado del lead.
--
-- La regla de subsanacion ya existia... pero solo en una de las dos capas:
-- sp_comercial_lead_update trae el bloque "[SUBSANAR]" que deja editar el lead
-- mientras la matricula esta observada, y despues ejecuta su UPDATE leads...
-- contra este trigger, que nunca se entero de esa excepcion. Resultado: el SP
-- aprobaba y el trigger tumbaba la transaccion con
-- "No se puede modificar el lead 430165 porque ya tiene enrollment_id (18729)".
-- Comercial no tenia forma de subsanar una observacion (caso 09/09/26).
--
-- Se alinea el candado con el SP: mientras la inscripcion este observada, el
-- lead vuelve a ser editable. Al reenviar, el registro devuelve el estado a
-- Pendiente y el lead queda congelado otra vez solo.
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

        -- Subsanacion en curso dentro del SP de registro: cuando llega aca, el
        -- SP YA devolvio la inscripcion de Observada a Pendiente, asi que mirar
        -- el estado (el EXISTS de abajo) da falso y el candado tumbaba el
        -- reenvio. Por eso el SP marca la transaccion; el 'true' de set_config
        -- la borra al terminar, no sobrevive a la conexion del pool.
        IF current_setting('we.resubmit_lead_id', true) = OLD.lead_id::text THEN
            RETURN NEW;
        END IF;

        -- Subsanacion vista desde afuera del SP: comercial corrige los datos del
        -- lead mientras la venta sigue Observada (paso previo al reenvio).
        -- Se busca por alias y no por catalog_id porque el id difiere entre la
        -- BD local y produccion.
        IF EXISTS (
            SELECT 1
              FROM public.enrollments e
              JOIN public.catalog c ON c.catalog_id = e.cat_fico_status
             WHERE e.enrollment_id = OLD.enrollment_id
               AND c.alias = 'we_enrollment_status_observed'
        ) THEN
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
