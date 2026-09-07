// Regla del 07/09/26: manda el CANAL. Una venta que dice "B2B - AE30" es B2B
// aunque AE30 sea comercial; el DOCUMENTO (OS/OP) por si solo no lo es.
//
// Este script contrasta las dos mitades contra el roster real del cronograma:
//   (a) las 156 ventas con canal B2B de un comercial => deben decir B2B,
//   (b) las 4 OS de AE30 sin canal                   => deben decir VENTAS.
import { q, pool } from './prod-db.mjs'
import { EditionRepository } from '../src/modules/edition/edition.repository.js'

const { rows: casos } = await q(`
  SELECT e.enrollment_id, e.program_edition_id, u.alias AS asesor, e.agent_origin,
         (e.cat_b2b_doctype IS NOT NULL) AS con_documento
    FROM enrollments e
    JOIN catalog cf ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
    LEFT JOIN users u ON u.user_id = e.seller_agent_id
   WHERE e.active = 'Y'
     AND u.alias IS NOT NULL AND u.alias NOT IN ('NY12','JF39')
     AND (e.agent_origin ILIKE '%b2b%' OR e.cat_b2b_doctype IS NOT NULL)`)

const sqlCronograma = await (async () => {
  let sql = null
  const repo = new EditionRepository({ query: (text) => { sql = text; return { rows: [] } } })
  await repo.classroomChannelMetricsList([])
  return sql
})()
const cte = sqlCronograma
  .slice(0, sqlCronograma.lastIndexOf(')\n    SELECT'))
  .replace('e.program_edition_id AS edition_num_id,',
           'e.enrollment_id, e.program_edition_id AS edition_num_id,')

const { rows: roster } = await q(`${cte})
  SELECT enrollment_id, comm_bucket, is_leaf, is_beca_leaf FROM roster WHERE enrollment_id = ANY($2::int[])`,
[[...new Set(casos.map(c => c.program_edition_id))], casos.map(c => c.enrollment_id)])
const porId = new Map(roster.map(r => [r.enrollment_id, r]))

const resumen = {
  'canal B2B => B2B': 0,
  'solo documento => VENTAS': 0,
  '1er curso de paquete (sin canal, su venta esta en el padre)': 0,
  'socio: MEMB gana sobre B2B en la cascada': 0
}
const fallos = []
for (const c of casos) {
  const r = porId.get(c.enrollment_id)
  if (!r) continue // no cuenta en su aula (retirado, RP, padre A5...)

  // Las dos excepciones de la cascada, anteriores a esta regla y legitimas.
  if (r.comm_bucket === null) { resumen['1er curso de paquete (sin canal, su venta esta en el padre)']++; continue }
  if (r.comm_bucket === 'MEMB') { resumen['socio: MEMB gana sobre B2B en la cascada']++; continue }

  const conCanal = /b2b/i.test(c.agent_origin || '')
  const esperado = conCanal ? 'B2B' : 'VENTAS'
  if (r.comm_bucket === esperado) resumen[conCanal ? 'canal B2B => B2B' : 'solo documento => VENTAS']++
  else fallos.push(`#${c.enrollment_id} ${c.asesor} canal=${c.agent_origin ?? '—'} doc=${c.con_documento}: ${r.comm_bucket}, se esperaba ${esperado}`)
  if (r.is_beca_leaf) fallos.push(`#${c.enrollment_id} cuenta como BECA`)
}

console.log(`Ventas de asesor comercial con canal B2B o documento: ${casos.length} (${porId.size} cuentan en su aula)`)
console.table(resumen)
console.log(fallos.length ? `\nDESVIACIONES (${fallos.length}):\n` + fallos.slice(0, 20).join('\n') : '\nTodas clasificadas segun la regla del canal.')

await pool.end()
