// F. PAGO de las hojas != fecha de pago del ERP, en 39 ventas desde julio/26.
//
// Causa: la columna F. PAGO sale de la cascada
// leads.pay_date -> primer payments.payment_date -> registration_date, y
// leads.pay_date gana. confirmPayment llama a syncLeadPayDate para alinearla
// con la fecha real que graba FICO, pero el trigger block_update_when_enrolled
// prohibe TODO update sobre un lead que ya tiene enrollment_id -- justo la
// condicion en la que corre el sync. La excepcion moria en un console.error.
//
// Este script hace las dos mitades, en produccion y de forma idempotente:
//   1. Afloja el trigger: deja pasar el update cuando lo unico que cambia es
//      pay_date / user_modification_id. El resto del lead sigue congelado.
//   2. Backfill: alinea leads.pay_date con el pago activo mas antiguo en las
//      ventas ya desincronizadas.
//
// El backfill corre CON el trigger vivo a proposito: si el paso 1 quedo mal, el
// paso 2 falla en vez de dejar el sync roto y silencioso otros dos meses.
//
//   DOTENV_CONFIG_PATH=.env.bak-produccion node scripts/fix-pay-date-desync.mjs
import { writeFileSync } from 'node:fs'
import { q, pool } from './db.mjs'

const DESDE = '2026-07-01'

const AFLOJAR_TRIGGER = `
CREATE OR REPLACE FUNCTION public.trg_block_update_if_enrolled() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.enrollment_id IS NOT NULL THEN
        -- FICO corrige la fecha de pago del lead ya vendido: leads.pay_date es
        -- la que manda en la columna F. PAGO de las hojas, asi que el sync de
        -- confirmPayment tiene que poder escribirla. Todo lo demas del lead
        -- sigue congelado despues de la venta.
        IF to_jsonb(NEW) - 'pay_date' - 'user_modification_id'
         = to_jsonb(OLD) - 'pay_date' - 'user_modification_id' THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION
            'No se puede modificar el lead % porque ya tiene enrollment_id (%).',
            OLD.lead_id,
            OLD.enrollment_id;
    END IF;

    RETURN NEW;
END;
$$;`

const DESINCRONIZADAS = `
  SELECT e.enrollment_id, l.lead_id,
         l.pay_date::date              AS pay_date_lead,
         fp.payment_date::date         AS pay_date_real
    FROM public.enrollments e
    JOIN public.leads l ON l.enrollment_id = e.enrollment_id
    LEFT JOIN LATERAL (
      SELECT py.payment_date FROM public.payments py
       WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y'
       ORDER BY py.payment_date ASC LIMIT 1
    ) fp ON TRUE
   WHERE e.active = 'Y'
     AND e.registration_date >= DATE '${DESDE}'
     AND fp.payment_date IS NOT NULL
     AND l.pay_date IS DISTINCT FROM fp.payment_date::date
   ORDER BY e.enrollment_id`

// El tunel SSH se cae seguido: esperamos a que vuelva en vez de abortar a medias.
async function esperarTunel (intentos = 40) {
  for (let i = 1; i <= intentos; i++) {
    try {
      await q('SELECT 1')
      return
    } catch (e) {
      console.log(`[${i}/${intentos}] tunel caido (${e.message}); reintento en 15s`)
      await new Promise(r => setTimeout(r, 15000))
    }
  }
  throw new Error('El tunel SSH no volvio: abre la conexion "Produccion - System ERP" en DBeaver')
}

await esperarTunel()

await q(AFLOJAR_TRIGGER)
console.log('Trigger block_update_when_enrolled: ahora deja pasar pay_date.')

const { rows: antes } = await q(DESINCRONIZADAS)
console.log(`Desincronizadas desde ${DESDE}: ${antes.length}`)
console.table(antes)

if (antes.length) {
  writeFileSync('scripts/_backup_pay_date_desync_2026-09-01.json', JSON.stringify(antes, null, 2))

  const { rowCount } = await q(`
    UPDATE public.leads l
       SET pay_date = fp.payment_date::date
      FROM public.enrollments e
      JOIN LATERAL (
        SELECT py.payment_date FROM public.payments py
         WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y'
         ORDER BY py.payment_date ASC LIMIT 1
      ) fp ON TRUE
     WHERE l.enrollment_id = e.enrollment_id
       AND e.active = 'Y'
       AND e.registration_date >= DATE '${DESDE}'
       AND l.pay_date IS DISTINCT FROM fp.payment_date::date`)
  console.log(`Leads alineados: ${rowCount}`)
}

const { rows: despues } = await q(DESINCRONIZADAS)
console.log(`Quedan desincronizadas: ${despues.length}`)
if (despues.length) {
  console.table(despues)
  throw new Error('El backfill no alineo todas las ventas')
}

await pool.end()
