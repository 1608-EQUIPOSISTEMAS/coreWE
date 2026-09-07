// Barrido: ¿las ventas con Orden de Servicio/Compra CONFIRMADAS cuentan en el
// aula y en el cronograma? Desde el 2026-08-11 nacen con monto real y cuota
// pendiente (antes eran pago cero), y el riesgo era que algun filtro las
// tratara como beca o las dejara fuera del roster.
//
// Reusa el SQL literal del cronograma (stub de db que captura el query).
import { q, pool } from './prod-db.mjs'
import { EditionRepository } from '../src/modules/edition/edition.repository.js'

const DESDE = process.argv[2] || '2026-08-11'

const { rows: ventas } = await q(`
  SELECT e.enrollment_id, e.program_edition_id, e.total_amount, e.registration_date::date AS fecha,
         cbd.alias AS doctype, cts.alias AS estado, pv.abbreviation AS programa, pe.specific_code,
         u.alias AS asesor,
         ARRAY(SELECT ch.enrollment_id FROM enrollments ch
                WHERE ch.parent_enrollment_id = e.enrollment_id AND ch.active='Y') AS hijos
    FROM enrollments e
    JOIN catalog cbd ON cbd.catalog_id = e.cat_b2b_doctype
    JOIN catalog cf  ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
    LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
    LEFT JOIN users u ON u.user_id = e.seller_agent_id
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
   WHERE e.active = 'Y'
     AND cbd.alias IN ('we_enrollment_b2b_doctype_service_order','we_enrollment_b2b_doctype_purchase_order')
     AND e.registration_date >= $1
   ORDER BY e.enrollment_id`, [DESDE])

const sqlCronograma = await (async () => {
  let sql = null
  const repo = new EditionRepository({ query: (text) => { sql = text; return { rows: [] } } })
  await repo.classroomChannelMetricsList([])
  return sql
})()
const cte = sqlCronograma
  .slice(0, sqlCronograma.lastIndexOf(')\n    SELECT'))
  .replace('e.program_edition_id AS edition_num_id,',
           'e.enrollment_id, e.parent_enrollment_id, e.program_edition_id AS edition_num_id,')

const ids = [...new Set(ventas.flatMap(v => [v.enrollment_id, ...v.hijos]))]
const ediciones = [...new Set((await q(
  `SELECT program_edition_id FROM enrollments WHERE enrollment_id = ANY($1::int[])`, [ids]
)).rows.map(r => r.program_edition_id))]

const { rows: roster } = await q(`${cte})
  SELECT enrollment_id, parent_enrollment_id, edition_num_id, comm_bucket, is_leaf, is_beca_leaf
    FROM roster WHERE enrollment_id = ANY($2::int[])`, [ediciones, ids])
const porId = new Map(roster.map(r => [r.enrollment_id, r]))

const problemas = []
for (const v of ventas) {
  const r = porId.get(v.enrollment_id)
  const filas = [{ rol: 'venta', id: v.enrollment_id, ed: v.program_edition_id, r }]
  for (const h of v.hijos) filas.push({ rol: 'hijo', id: h, ed: porId.get(h)?.edition_num_id, r: porId.get(h) })

  // Convenio de verdad = sin asesor o con asesor de convenios. Si la cerro un
  // comercial, el documento NO la hace B2B: es venta suya (y su hijo, SEGUI).
  const esConvenio = v.asesor === null || ['NY12', 'JF39'].includes(v.asesor)
  const esperado = { venta: esConvenio ? 'B2B' : 'VENTAS', hijo: esConvenio ? 'B2B' : 'SEGUI' }

  for (const f of filas) {
    if (!f.r) { problemas.push(`#${f.id} (${f.rol} de ${v.enrollment_id}) NO aparece en el roster del cronograma`); continue }
    if (f.r.is_beca_leaf) problemas.push(`#${f.id} (${f.rol} de ${v.enrollment_id}) cuenta como BECA`)
    // null = 1er curso de paquete: su venta vive en el padre, no cuenta canal.
    if (f.r.comm_bucket !== null && f.r.comm_bucket !== esperado[f.rol]) {
      problemas.push(`#${f.id} (${f.rol} de ${v.enrollment_id}, asesor ${v.asesor ?? 'sin asesor'}) canal ${f.r.comm_bucket}, se esperaba ${esperado[f.rol]}`)
    }
    if (f.r.comm_bucket === null && f.rol === 'venta') problemas.push(`#${f.id} venta sin canal comercial`)
  }
}

console.log(`OS/OP confirmadas desde ${DESDE}: ${ventas.length}`)
console.table(ventas.map(v => {
  const r = porId.get(v.enrollment_id)
  return {
    id: v.enrollment_id, fecha: v.fecha, doc: v.doctype.replace('we_enrollment_b2b_doctype_', ''),
    asesor: v.asesor ?? 'sin asesor',
    total: v.total_amount, estado: v.estado?.replace('we_enrollment_status_', '').replace('we_inscription_way_', ''),
    programa: v.programa, ed: v.specific_code,
    canal: r ? (r.comm_bucket ?? '—') : 'FUERA DEL ROSTER',
    aula: r ? (r.is_leaf && !r.is_beca_leaf ? 'si' : 'no (es la venta)') : '—',
    hijos: v.hijos.join(',') || '—',
    canal_hijos: v.hijos.map(h => porId.get(h)?.comm_bucket ?? '—').join(',') || '—'
  }
}))

console.log(problemas.length ? `\nPROBLEMAS (${problemas.length}):\n` + problemas.join('\n') : '\nSin problemas: convenio => B2B, comercial => VENTAS/SEGUI, 1er curso sin canal, ninguna como beca.')
await pool.end()
