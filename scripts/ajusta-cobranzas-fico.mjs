// Fase 3 del alta desde la hoja FICO: lo que las fases 1 y 2 no saben leer.
//
//  - `marca-pagos-hoja-fico.mjs` aplica UN solo medio/cuenta a todos los pagos
//    (el de la fila de inscripciones). La fila de COBRANZAS trae medio, entidad
//    y N de operacion POR CUOTA: aqui se pisan uno por uno.
//  - El SP deja la reserva (cuota #0) venciendo HOY; el vencimiento real es la
//    F. PAGO de la hoja.
//  - MODALIDAD "FLEX" se pierde: el importador matchea el catalogo por texto
//    exacto ("Modalidad Flexible") y degrada en silencio a "Modalidad Normal".
//
// Idempotente: son UPDATEs deterministas, correrlo dos veces deja lo mismo.
//
// Uso (desde Backend/, con DATABASE_URL de produccion):
//   node scripts/ajusta-cobranzas-fico.mjs            (dry-run)
//   node scripts/ajusta-cobranzas-fico.mjs --aplicar
import { q, pool } from './db.mjs'

const YAPE = 3205
const CULQUI = 3208
const MERCADO_PAGO = 3256
const CUENTA_WEF_BCP_PEN = 16 // WE FOUNDATION / BCP / PEN
const MODALIDAD_FLEXIBLE = 2625

// `cuenta: null` = respetar la que dejo el import. Pasa cuando la hoja de
// cobranzas trae el medio pero deja la empresa en blanco (tipico de Mercado
// Pago): no se inventa una cuenta que la hoja no declaro.
const AJUSTES = [
  {
    enrollment: 18185, // SANCHEZ GONZALO DIEGO FRANCO - BI-DZ-02 E33
    reservaVence: '2026-04-24',
    cuotas: [
      { n: 1, medio: YAPE, cuenta: CUENTA_WEF_BCP_PEN, operacion: '23374624' },
      { n: 2, medio: YAPE, cuenta: CUENTA_WEF_BCP_PEN, operacion: '33611611' },
      { n: 3, medio: MERCADO_PAGO, cuenta: null, operacion: null },
      { n: 4, medio: MERCADO_PAGO, cuenta: null, operacion: null }
    ]
  },
  {
    enrollment: 18197, // CONISLLA ABURTO ANA CECILIA - SA-EZ-06 E0 (convalidacion)
    reservaVence: '2025-11-19',
    modalidad: MODALIDAD_FLEXIBLE, // la hoja dice MOD FLEX
    cuotas: [
      { n: 1, medio: MERCADO_PAGO, cuenta: null, operacion: null },
      { n: 2, medio: MERCADO_PAGO, cuenta: null, operacion: null }
    ]
  }
]

const aplicar = process.argv.includes('--aplicar')
const guarda = aplicar ? 'TRUE' : 'FALSE'

for (const { enrollment, reservaVence, modalidad, cuotas } of AJUSTES) {
  console.log(`\n--- enrollment ${enrollment} ---`)

  for (const { n, medio, cuenta, operacion } of cuotas) {
    const { rows } = await q(`
      UPDATE public.payments p
         SET cat_method_payment = $3,
             settled_in_account_id = COALESCE($4, p.settled_in_account_id),
             transaction_code = COALESCE($5, p.transaction_code)
        FROM public.payment_installments i
       WHERE i.installment_id = p.installment_id
         AND p.enrollment_id = $1 AND i.installment_number = $2 AND ${guarda}
   RETURNING p.payment_id`, [enrollment, n, medio, cuenta, operacion])
    console.log(`  cuota ${n}: medio=${medio} cuenta=${cuenta ?? '(sin cambio)'} op=${operacion ?? '-'} -> ${rows.length} pago(s)`)
  }

  const { rows: reserva } = await q(`
    UPDATE public.payment_installments
       SET due_date = $2::date
     WHERE enrollment_id = $1 AND installment_number = 0 AND ${guarda}
 RETURNING installment_id`, [enrollment, reservaVence])
  console.log(`  reserva vence ${reservaVence} -> ${reserva.length} cuota(s)`)

  if (modalidad) {
    const { rows } = await q(`
      UPDATE public.enrollments SET cat_inscription_modality = $2
       WHERE enrollment_id = $1 AND ${guarda}
   RETURNING enrollment_id`, [enrollment, modalidad])
    console.log(`  modalidad ${modalidad} -> ${rows.length} inscripcion(es)`)
  }
}

if (!aplicar) console.log('\n(dry-run: nada escrito; agrega --aplicar)')
await pool.end()
