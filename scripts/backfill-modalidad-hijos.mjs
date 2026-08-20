// Alinea la modalidad de los cursos hijos con la de su paquete padre.
//
// Hasta el 2026-08-20 `changeModality` solo tocaba la fila del padre, asi que
// los hijos se quedaban con la modalidad original y el aula no los mostraba
// como FLEX (edition.repository lee e.cat_inscription_modality fila por fila).
// El flujo ya cascadea; esto repara lo que quedo divergente.
//
// Uso (primero pruebas, produccion solo con visto bueno del usuario):
//   cd Backend && node scripts/backfill-modalidad-hijos.mjs          # solo lista
//   cd Backend && node scripts/backfill-modalidad-hijos.mjs --aplicar
import { q, pool } from './db.mjs'

const aplicar = process.argv.includes('--aplicar')

const DIVERGENTES = `
  SELECT h.enrollment_id,
         h.parent_enrollment_id,
         h.cat_inscription_modality AS modalidad_hijo,
         ch.description             AS desc_hijo,
         p.cat_inscription_modality AS modalidad_padre,
         cp.description             AS desc_padre
    FROM enrollments h
    JOIN enrollments p ON p.enrollment_id = h.parent_enrollment_id
    LEFT JOIN catalog ch ON ch.catalog_id = h.cat_inscription_modality
    LEFT JOIN catalog cp ON cp.catalog_id = p.cat_inscription_modality
   WHERE h.cat_inscription_modality IS DISTINCT FROM p.cat_inscription_modality
   ORDER BY h.parent_enrollment_id, h.enrollment_id
`

const { rows } = await q(DIVERGENTES)

if (!rows.length) {
  console.log('Sin hijos divergentes: nada que hacer.')
  await pool.end()
  process.exit(0)
}

for (const r of rows) {
  console.log(`#${r.enrollment_id} (padre #${r.parent_enrollment_id}): ${r.desc_hijo || '---'} -> ${r.desc_padre || '---'}`)
}
console.log(`\n${rows.length} hijo(s) divergente(s).`)

if (!aplicar) {
  console.log('Modo lectura. Volver a correr con --aplicar para escribir.')
  await pool.end()
  process.exit(0)
}

const { rowCount } = await q(`
  UPDATE enrollments h
     SET cat_inscription_modality = p.cat_inscription_modality
    FROM enrollments p
   WHERE p.enrollment_id = h.parent_enrollment_id
     AND h.cat_inscription_modality IS DISTINCT FROM p.cat_inscription_modality
`)
console.log(`Actualizados: ${rowCount}`)

// El panel FICO lee de la matview: sin refresh el cambio no se ve.
await q('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_enrollment_report_system')
console.log('Matview refrescada.')

await pool.end()
