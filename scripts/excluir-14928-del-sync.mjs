// One-off (2026-09-01): BEJARANO VASQUEZ KATYA CECILIA, enrollment 14928 (WE BLACK).
//
// La membresia se cambio de curso el 01/09 (CC #24 -> destino 18289 GEST PROYECT E2)
// y sus 9 cuotas quedaron en Borrador: ya no se va a cobrar nada. Pero el origen
// seguia subiendo al Sheet FICO con S/2880 de contrato contra S/390 realmente
// cobrados, y desde el 15/09 habria empezado a mostrar "Deuda N" por cuotas que
// nadie va a cobrar (inst_overdue cuenta toda cuota vencida que no este pagada, y
// 'Borrador' no esta en la lista de estados pagados).
//
// Palanca elegida: cat_fico_status = 'CC'. Las 7 CTEs `approved` del sync exigen
// alias 'we_enrollment_status_checked', asi que la fila deja de subir a TODAS las
// hojas. Las otras dos opciones se descartaron con la prueba de abajo:
//   - notes con el token 'masiva FICO': EXCLUDE_IMPORTED tambien descarta a quien
//     tenga esa fila como padre, y el destino de un CC lleva parent = origen, asi
//     que se llevaba puesta la venta nueva (18289) y a la alumna del aula.
//   - active = 'N': la borra tambien del panel FICO (vw_enrollment_report_system
//     filtra e.active = 'Y') y con ella el ingreso real de S/390 dentro del ERP.
// La eleccion mantiene la venta viva en el ERP y solo la saca del Google Sheet.
//
// Reversible: UPDATE enrollments SET cat_fico_status = 3052 WHERE enrollment_id = 14928;
//
//   node scripts/excluir-14928-del-sync.mjs            # DRY-RUN contra PRODUCCION
//   node scripts/excluir-14928-del-sync.mjs --aplicar  # aplica
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
process.env.DATABASE_URL = fs.readFileSync(path.join(raiz, '.env.bak-produccion'), 'utf8')
  .match(/^DATABASE_URL=(.+)$/m)[1].trim()

const { pool, query: q } = await import('../src/shared/db/pool.js')
const { EXCLUDE_IMPORTED, EXCLUDE_UNCOLLECTED, PARENT_OR_CC_DESTINATION, SYNC_FROM } =
  await import('../src/modules/integration/integration.repository.js')

const ORIGEN = 14928
const DESTINO = 18289
const aplicar = process.argv.includes('--aplicar')

// La CTE `approved` real del repositorio, no una consulta paralela: si el filtro
// cambia, esta verificacion cambia con el.
const APPROVED = `
  SELECT e.enrollment_id
    FROM public.enrollments e
    JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
   WHERE cf.alias = 'we_enrollment_status_checked' AND e.active = 'Y'
     ${PARENT_OR_CC_DESTINATION} ${EXCLUDE_IMPORTED} ${EXCLUDE_UNCOLLECTED} ${SYNC_FROM}`

const enElSync = async (client = pool) => {
  const { rows } = await client.query(
    `WITH a AS (${APPROVED}) SELECT enrollment_id FROM a WHERE enrollment_id = ANY($1::int[]) ORDER BY 1`,
    [[ORIGEN, DESTINO]])
  return rows.map(r => r.enrollment_id)
}

const { rows: [antes] } = await q(
  `SELECT e.enrollment_id, cf.alias AS fico_alias, cf.description AS fico, cts.description AS estado, e.active
     FROM enrollments e
     LEFT JOIN catalog cf ON cf.catalog_id = e.cat_fico_status
     LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
    WHERE e.enrollment_id = $1`, [ORIGEN])
console.log('--- estado actual de 14928 ---'); console.table([antes])
console.log('en el sync hoy ->', await enElSync())

if (antes.fico_alias !== 'we_enrollment_status_checked') {
  console.log('\nYa no esta como Aprobado: nada que hacer (idempotente).')
  await pool.end(); process.exit(0)
}

const { rows: [cc] } = await q(
  "SELECT catalog_id FROM catalog WHERE alias = 'we_enrollment_status_course_changed'")

if (!aplicar) {
  const c = await pool.connect()
  await c.query('BEGIN')
  await c.query('UPDATE enrollments SET cat_fico_status = $1 WHERE enrollment_id = $2', [cc.catalog_id, ORIGEN])
  console.log(`\nDRY-RUN (revertido): con cat_fico_status = ${cc.catalog_id} quedarian en el sync ->`, await enElSync(c))
  await c.query('ROLLBACK'); c.release()
  console.log('Correr con --aplicar para escribirlo.')
  await pool.end(); process.exit(0)
}

await q('UPDATE enrollments SET cat_fico_status = $1 WHERE enrollment_id = $2', [cc.catalog_id, ORIGEN])
console.log('\nAplicado. En el sync ahora ->', await enElSync())
console.table((await q(
  `SELECT e.enrollment_id, cf.description AS fico, cts.description AS estado, e.active
     FROM enrollments e
     LEFT JOIN catalog cf ON cf.catalog_id = e.cat_fico_status
     LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
    WHERE e.enrollment_id = ANY($1::int[])`, [[ORIGEN, DESTINO]])).rows)
await pool.end()
