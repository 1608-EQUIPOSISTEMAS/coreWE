// sp_edition_caller alimenta TODOS los selectores de edicion del ERP
// (EnrollmentForm, Cambio de Curso, Leads, arbol de Editions, migracion A5) y
// no filtraba las ediciones canceladas: una A5 conserva active='Y' y solo
// cambia program_editions.cat_segment al catalogo we_segment_a5.
//
// Verificado en produccion: NO existe edicion con active='N' que no sea A5
// (254/254), asi que cat_segment es la unica fuente de verdad. No hay que
// tocar p_active.
//
// Este script agrega esa exclusion al WHERE de los dos overloads del SP, es
// idempotente, y al final vuelca la definicion resultante a
// scripts/sp_edition_caller.sql (archivo canonico, misma convencion que
// sp_fico_enrollment_register_direct.sql). El estado previo queda en
// scripts/_sp_edition_caller.backup.sql.
//
//   export PGPASSWORD='...'; node scripts/fix-edition-caller-excluir-a5.mjs
import { writeFileSync, existsSync } from 'node:fs'
import { q, pool } from './db.mjs'

// IS DISTINCT FROM cubre el caso NULL sin un OR extra. El id se resuelve por
// alias para no clavar un 3060 magico: es un InitPlan, se evalua una vez.
const GUARD = "AND e.cat_segment IS DISTINCT FROM (SELECT catalog_id FROM public.catalog WHERE alias = 'we_segment_a5')"
const GUARD_VIEJO = 'AND (e.cat_segment IS NULL OR e.cat_segment <> 3060)  -- A5 = edicion cancelada'
const ANCHOR = 'AND e.program_version_id = p_program_version_id'
const BACKUP = new URL('./_sp_edition_caller.backup.sql', import.meta.url)
const CANONICO = new URL('./sp_edition_caller.sql', import.meta.url)

const defs = async () => (await q(`
  SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'sp_edition_caller'
  ORDER BY pronargs`)).rows.map(r => r.def)

const antes = await defs()
if (!antes.length) throw new Error('No existe sp_edition_caller')
if (!existsSync(BACKUP)) writeFileSync(BACKUP, antes.join('\n\n'), 'utf8')

for (const def of antes) {
  if (def.includes(GUARD)) { console.log('Overload ya parcheado, se omite.'); continue }
  // Segunda pasada: reemplaza la version con el literal 3060 por la de alias.
  if (def.includes(GUARD_VIEJO)) {
    await q(def.replace(GUARD_VIEJO, `${GUARD}  -- A5 = edicion cancelada`))
    console.log('Overload migrado a lookup por alias.')
    continue
  }
  if (!def.includes(ANCHOR)) throw new Error('No encontre el ancla en el WHERE; revisar el SP a mano')
  await q(def.replace(ANCHOR, `${GUARD}  -- A5 = edicion cancelada\n    ${ANCHOR}`))
  console.log('Overload parcheado.')
}

// Verificacion: una edicion A5 futura ya no debe salir para su programa.
const { rows: [caso] } = await q(`
  SELECT edition_num_id, program_version_id FROM public.program_editions
  WHERE cat_segment = (SELECT catalog_id FROM public.catalog WHERE alias = 'we_segment_a5')
    AND start_date >= CURRENT_DATE AND active = 'Y' LIMIT 1`)
if (!caso) {
  console.log('Sin ediciones A5 futuras para verificar.')
} else {
  await q('BEGIN')
  await q(`CALL public.sp_edition_caller($1, NULL, NULL, NULL, NULL, NULL, 'c')`, [caso.program_version_id])
  const { rows: out } = await q('FETCH ALL FROM c')
  await q('COMMIT')
  if (out.some(r => r.edition_num_id === caso.edition_num_id)) {
    throw new Error(`FALLO: la A5 ${caso.edition_num_id} sigue apareciendo`)
  }
  console.log(`OK: programa ${caso.program_version_id} devuelve ${out.length} ediciones y la A5 ${caso.edition_num_id} no esta.`)
}

writeFileSync(CANONICO, `-- Definicion canonica de sp_edition_caller (volcada desde produccion).
-- Editar ESTE archivo y desplegarlo; no hacer read-modify-write contra la BD.
-- Los dos overloads (con y sin p_month/p_year) se mantienen porque el 5-arg
-- sigue existiendo en la BD, aunque hoy nadie lo llama.

${(await defs()).join(';\n\n')};
`, 'utf8')
console.log('Definicion canonica volcada a scripts/sp_edition_caller.sql')

await pool.end()
