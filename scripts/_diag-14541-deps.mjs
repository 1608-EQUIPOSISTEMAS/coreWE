// Qué cuelga del enrollment 14541 y del token 519 (antes de borrar nada).
import { q, pool } from './db.mjs'

const { rows: fks } = await q(`
  SELECT c.conrelid::regclass::text AS tabla, a.attname AS columna
    FROM pg_constraint c
    JOIN unnest(c.conkey) k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.contype = 'f' AND c.confrelid = 'enrollments'::regclass
   ORDER BY 1`)
console.log('--- FKs que apuntan a enrollments ---')
console.table(fks)

for (const { tabla, columna } of fks) {
  const { rows } = await q(`SELECT count(*)::int AS n FROM ${tabla} WHERE ${columna} = 14541`)
  if (rows[0].n) console.log(`  ${tabla}.${columna}: ${rows[0].n} fila(s)`)
}

const { rows: audit } = await q(`
  SELECT log_id, enrollment_id, token_id, action, performed_by, created_at, left(details, 90) AS details
    FROM enrollment_audit_log
   WHERE enrollment_id = 14541 OR token_id IN (519, 522)
   ORDER BY log_id`)
console.log('--- enrollment_audit_log ---'); console.table(audit)

const { rows: cust } = await q(`
  SELECT c.customer_id, p.name, p.last_name, p.email
    FROM customers c JOIN persons p ON p.person_id = c.person_id
   WHERE c.customer_id = 18314`).catch(() => ({ rows: [] }))
console.log('--- customer 18314 ---'); console.table(cust)
await pool.end()
