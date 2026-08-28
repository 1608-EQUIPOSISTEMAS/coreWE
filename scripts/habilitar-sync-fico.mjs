// Readmite al sync de Google Sheets inscripciones que quedaron fuera porque su
// `notes` conserva el marcador de la importacion masiva: EXCLUDE_IMPORTED
// (integration.repository.js) descarta todo lo que haga LIKE '%masiva FICO%'.
// Cuando la venta es real (verificada, con su pago o su orden de servicio), se
// reescribe SOLO esa linea: conserva la procedencia y pierde el token.
//
// Idempotente: si el marcador ya no esta, no toca nada.
//
// Uso:  node scripts/habilitar-sync-fico.mjs 2495 [2496 ...] [--aplicar]
import { q, pool } from './db.mjs'
import { EXCLUDE_IMPORTED, EXCLUDE_UNCOLLECTED, SYNC_FROM, PARENT_OR_CC_DESTINATION }
  from '../src/modules/integration/integration.repository.js'

const MARCADOR = 'Importacion masiva FICO (hoja)'
const REEMPLAZO = 'Importado de la hoja FICO'

const aplicar = process.argv.includes('--aplicar')
const ids = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number)
if (ids.length === 0) {
  console.error('Falta al menos un enrollment_id.\n  node scripts/habilitar-sync-fico.mjs 2495 [--aplicar]')
  process.exit(1)
}

// El mismo CTE `approved` que arma getFicoSales, para no verificar con una
// consulta paralela que pueda divergir del sync de verdad.
const entranAlSync = async () => {
  const { rows } = await q(`
    SELECT e.enrollment_id
      FROM public.enrollments e
      JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
     WHERE cf.alias = 'we_enrollment_status_checked'
       AND e.active = 'Y'
       AND e.enrollment_id = ANY($1::int[])
       ${PARENT_OR_CC_DESTINATION}
       ${EXCLUDE_IMPORTED}
       ${EXCLUDE_UNCOLLECTED}
       ${SYNC_FROM}`, [ids])
  return rows.map(r => r.enrollment_id)
}

const notas = async () =>
  (await q('SELECT enrollment_id, notes FROM enrollments WHERE enrollment_id = ANY($1::int[]) ORDER BY 1', [ids])).rows

console.log('BD:', (await q('SELECT current_database() AS db')).rows[0].db)
console.log('antes  ->', await notas())
console.log('en el sync antes:', await entranAlSync())

if (!aplicar) {
  console.log('\n(dry-run) volver a correr con --aplicar')
} else {
  const { rowCount } = await q(
    `UPDATE enrollments SET notes = REPLACE(notes, $2, $3), modification_date = NOW()
      WHERE enrollment_id = ANY($1::int[]) AND notes LIKE '%' || $2 || '%'`,
    [ids, MARCADOR, REEMPLAZO])
  console.log(`filas actualizadas: ${rowCount}`)
  console.log('despues ->', await notas())
  console.log('en el sync despues:', await entranAlSync())
}
await pool.end()
