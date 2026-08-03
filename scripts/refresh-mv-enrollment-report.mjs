// El panel FICO lee mv_enrollment_report_system, asi que un UPDATE directo en
// enrollments no se ve hasta refrescarla. Paso final obligatorio de toda correccion.
//   node scripts/refresh-mv-enrollment-report.mjs <id>             -> refresca y verifica
//   node scripts/refresh-mv-enrollment-report.mjs <id> --solo-ver  -> solo verifica
//
// Nota: las matviews NO aparecen en information_schema.columns; hay que leerlas de
// pg_attribute o el listado sale vacio.
import { q, pool } from './db.mjs'

const ID = Number(process.argv[2])
if (!ID) { console.error('Uso: node scripts/refresh-mv-enrollment-report.mjs <enrollment_id> [--solo-ver]'); process.exit(1) }
const soloVer = process.argv.includes('--solo-ver')

if (!soloVer) {
  console.time('refresh')
  await q('REFRESH MATERIALIZED VIEW public.mv_enrollment_report_system')
  console.timeEnd('refresh')
}

const cols = await q(
  `SELECT a.attname FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relname = 'mv_enrollment_report_system' AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum`
)
const nombres = cols.rows.map(r => r.attname)
console.log('--- columnas de la matview ---')
console.log(nombres.join(', '))

const idCol = nombres.find(n => /^enrollment_id$/i.test(n)) ||
              nombres.find(n => /enrollment/i.test(n) && /id/i.test(n)) ||
              nombres[0]
console.log('\nfiltrando por:', idCol)

const r = await q(`SELECT * FROM mv_enrollment_report_system WHERE "${idCol}" = $1`, [ID])
console.table(r.rows)

await pool.end()
