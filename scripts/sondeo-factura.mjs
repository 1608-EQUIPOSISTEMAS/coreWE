// Sondeo: que guarda "COMPROBANTES DE PAGO" y si el ERP conoce series tipo FF01.
import { q, pool } from './db.mjs'
const r = await q(`
  SELECT "COMPROBANTES DE PAGO" AS comp
    FROM vw_enrollment_report_system
   WHERE "COMPROBANTES DE PAGO" IS NOT NULL AND "COMPROBANTES DE PAGO" <> ''
   LIMIT 8`)
console.table(r.rows)

const ff = await q(`
  SELECT COUNT(*)::int AS n FROM vw_enrollment_report_system
   WHERE "COMPROBANTES DE PAGO" ILIKE '%FF01%'`)
console.log('filas con FF01 en el reporte:', ff.rows[0].n)
await pool.end()
