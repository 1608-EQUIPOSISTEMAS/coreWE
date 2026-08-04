// Columna del flag "comercial pidio copia" (bloquea el envio en FICO si el CC
// quedo vacio). Idempotente: se puede re-correr sin efecto.
//   export PGPASSWORD='...'; node scripts/add-requires-email-cc.mjs
import { q, pool } from './db.mjs'

const SQL = `
  ALTER TABLE public.enrollments
    ADD COLUMN IF NOT EXISTS requires_email_cc boolean NOT NULL DEFAULT false;
`

try {
  await q(SQL)
  const { rows } = await q(`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'enrollments'
      AND column_name IN ('email_cc', 'requires_email_cc')
    ORDER BY column_name
  `)
  console.table(rows)
} catch (err) {
  console.error('[add-requires-email-cc] fallo:', err.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
