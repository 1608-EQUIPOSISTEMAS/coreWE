// Token 690 (enrollment 17948) se emitio por S/200 cuando la 1ra cuota
// (reserva diferida del plan) es de S/100. Solo corrige el monto; el link de
// Culqi ya emitido no cambia.
import { q, pool } from './db.mjs'

const TOKEN_ID = 690
const MONTO_CORRECTO = '100.00'

const { rows } = await q(
  `UPDATE payment_tokens SET amount = $2, updated_at = now()
    WHERE token_id = $1 AND amount = '200.00'
    RETURNING token_id, enrollment_id, amount, status`,
  [TOKEN_ID, MONTO_CORRECTO]
)
console.log(rows.length ? rows : 'sin cambios: el monto ya no era 200.00')
await pool.end()
