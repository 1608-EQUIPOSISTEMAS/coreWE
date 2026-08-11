// One-off: la venta 16226 se registro con Orden de Servicio ANTES de que el SP
// comercial supiera leer cat_b2b_doctype, asi que el campo llego nulo y el panel
// de FICO la trata como una venta con pago al momento.
//
// Deja la inscripcion igual a como nace hoy una OS/OP:
//   1. cat_b2b_doctype = Orden de Servicio
//   2. baja el placeholder de payments (cat_payment_type=3113, sin numero de
//      operacion ni voucher): en una OS no existe, la plata aun no llego.
// La cuota ya estaba pendiente, que es lo correcto: no se toca.
//
//   node scripts/fix-16226-orden-servicio.mjs --dry   # muestra el antes, no escribe
//   node scripts/fix-16226-orden-servicio.mjs         # aplica
//
// Para revertir: cat_b2b_doctype = NULL y active='Y' en el payment listado abajo.
import { q, pool } from './db.mjs'

const DRY = process.argv.includes('--dry')
const ENROLLMENT_ID = 16226

const estado = async () => {
  const { rows: [e] } = await q(`
    SELECT e.cat_b2b_doctype, c.description AS doctype, e.total_amount,
           (SELECT COUNT(*) FROM payments p WHERE p.enrollment_id = e.enrollment_id AND p.active = 'Y')::int AS pagos_activos
      FROM enrollments e
      LEFT JOIN catalog c ON c.catalog_id = e.cat_b2b_doctype
     WHERE e.enrollment_id = $1`, [ENROLLMENT_ID])
  return e
}

try {
  const antes = await estado()
  if (!antes) throw new Error(`El enrollment ${ENROLLMENT_ID} no existe.`)
  console.log('ANTES: ', antes)

  if (DRY) {
    console.log('\n--dry: no se escribio nada.')
  } else {
    const { rows: [os] } = await q(
      "SELECT catalog_id FROM catalog WHERE alias = 'we_enrollment_b2b_doctype_service_order'")
    if (!os) throw new Error('Falta el catalogo we_enrollment_b2b_doctype_service_order.')

    await q('UPDATE enrollments SET cat_b2b_doctype = $2 WHERE enrollment_id = $1',
      [ENROLLMENT_ID, os.catalog_id])

    // Solo el placeholder: un pago real (con numero de operacion) no se toca.
    const { rows: bajados } = await q(`
      UPDATE payments SET active = 'N'
       WHERE enrollment_id = $1 AND active = 'Y'
         AND cat_payment_type = 3113
         AND NULLIF(TRIM(COALESCE(transaction_code, '')), '') IS NULL
       RETURNING payment_id, amount`, [ENROLLMENT_ID])
    console.log('placeholders dados de baja:', bajados)

    console.log('DESPUES:', await estado())
  }
} catch (e) {
  console.error('FALLO:', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
