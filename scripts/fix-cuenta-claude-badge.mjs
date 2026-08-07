// Vincula el beneficio "CUENTA CLAUDE" (discount 49) a las inscripciones del
// curso CLAUDE : IA APLICADA (program 239) de los alumnos que usaran su cuenta
// personal, para que el panel FICO les muestre el badge "CUENTA PERSONAL".
//
// Por que calculated_amount = 0:
//   El badge se dispara por el TEXTO del descuento, no por su monto
//   (Frontend/src/composables/useEnrollmentFormatters.js -> hasClaudeAccount).
//   Estas 5 inscripciones son Member Black: list_price = total_amount = 0, el
//   curso ya viene incluido en la membresia. Aplicar los S/100 del catalogo
//   dejaria enrollments.discount_amount (0) descuadrado contra la suma de
//   enrollment_discounts (100). Con 0 el badge sale igual y no se toca dinero.
//
// Idempotente: si la fila ya existe no la duplica ni la pisa (jesuscelisarias y
// johnespinozak96 ya la tienen con su descuento real de S/100 y quedan intactos).
//
//   node scripts/fix-cuenta-claude-badge.mjs --dry 15900   # muestra el diff, no guarda
//   node scripts/fix-cuenta-claude-badge.mjs 15900         # aplica
//
// Lote original (06/08/26, Member Black): 13946 14054 14523 14766 15658.
import { q, pool } from './db.mjs'

const DRY = process.argv.includes('--dry')

const DISCOUNT_CUENTA_CLAUDE = 49
const ORDER_APPLIED = 3          // mismo orden que los 8 casos ya existentes
const ENROLLMENTS = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number)
if (!ENROLLMENTS.length) throw new Error('uso: node scripts/fix-cuenta-claude-badge.mjs [--dry] <enrollment_id...>')

async function main () {
  await q('BEGIN')

  // El descuento debe existir y decir CUENTA CLAUDE: si alguien renombra la fila
  // del catalogo, el badge deja de salir y este script no tendria sentido.
  const { rows: [d] } = await q(
    `SELECT description FROM public.discounts WHERE discount_id = $1`,
    [DISCOUNT_CUENTA_CLAUDE]
  )
  if (!d || !/CUENTA\s+CLAUDE/i.test(d.description)) {
    throw new Error(`discount ${DISCOUNT_CUENTA_CLAUDE} no es 'CUENTA CLAUDE' (es: ${d?.description ?? 'inexistente'})`)
  }

  // user_registration_id = quien registro la inscripcion. Es el dato mas fiel
  // disponible para "quien aplico el beneficio" sin inventar un usuario.
  const { rows } = await q(
    `INSERT INTO public.enrollment_discounts
       (enrollment_id, discount_id, order_applied, calculated_amount, applied_at, user_registration_id)
     SELECT e.enrollment_id, $2, $3, 0.00, NOW(), e.user_registration_id
     FROM public.enrollments e
     WHERE e.enrollment_id = ANY($1::int[])
       AND NOT EXISTS (
         SELECT 1 FROM public.enrollment_discounts ed
          WHERE ed.enrollment_id = e.enrollment_id AND ed.discount_id = $2
       )
     RETURNING enrollment_id`,
    [ENROLLMENTS, DISCOUNT_CUENTA_CLAUDE, ORDER_APPLIED]
  )
  rows.forEach(r => console.log(`+ CUENTA CLAUDE -> enrollment ${r.enrollment_id}`))
  if (!rows.length) console.log('sin cambios: todas ya tenian el beneficio')

  await q(DRY ? 'ROLLBACK' : 'COMMIT')

  // Verificacion post-commit: estado real de las 7 inscripciones del curso.
  const { rows: check } = await q(
    `SELECT e.enrollment_id, per.first_name || ' ' || per.last_name AS alumno,
            e.list_price, e.discount_amount, e.total_amount,
            (SELECT ed.calculated_amount FROM public.enrollment_discounts ed
              WHERE ed.enrollment_id = e.enrollment_id AND ed.discount_id = $2) AS badge_monto
     FROM public.enrollments e
     JOIN public.customers cust ON cust.customer_id = e.customer_id
     JOIN public.persons per    ON per.person_id = cust.person_id
     WHERE e.enrollment_id = ANY($1::int[])
     ORDER BY e.enrollment_id`,
    [ENROLLMENTS, DISCOUNT_CUENTA_CLAUDE]
  )
  console.log(`\n=== estado ${DRY ? '(simulado, revertido)' : 'final'} ===`)
  console.table(check)

  // El panel FICO lee la cabecera de la matview: sin refresh el badge no aparece.
  if (!DRY) {
    await q('REFRESH MATERIALIZED VIEW public.mv_enrollment_report_system')
    console.log('\nmatview mv_enrollment_report_system refrescada.')
  }
}

// El tunel SSH se cae seguido: un reintento completo, todo en la misma transaccion.
try {
  await main()
} catch (err) {
  console.warn('fallo, reintentando:', err.message)
  await q('ROLLBACK').catch(() => {})
  await main()
} finally {
  await pool.end()
}
