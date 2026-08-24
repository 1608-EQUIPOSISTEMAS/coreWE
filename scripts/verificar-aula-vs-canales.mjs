// Verifica la invariante que muestra el cronograma: AULA = VEN + SEG + MEM + B2B.
//
// No reescribe la logica: le roba el SQL literal a
// EditionRepository.classroomChannelMetricsList (stub de db que captura el
// query) y le cambia el SELECT final por un detalle por inscrito. Asi el
// chequeo no puede divergir del cronograma.
//
// Uso: node scripts/verificar-aula-vs-canales.mjs [YYYY-MM-DD]   (default 2026-08-01)
import { q, pool } from './db.mjs'
import { EditionRepository } from '../src/modules/edition/edition.repository.js'

const DESDE = process.argv[2] || '2026-08-01'

// SQL real del cronograma: el stub captura el texto y lo devuelve vacio.
const capturado = await (async () => {
  let sql = null
  const repo = new EditionRepository({ query: (text) => { sql = text; return { rows: [] } } })
  await repo.classroomChannelMetricsList([])
  return sql
})()

const cte = capturado
  .slice(0, capturado.lastIndexOf(')\n    SELECT'))          // corta el SELECT agregado
  .replace('e.program_edition_id AS edition_num_id,',
           'e.enrollment_id, e.parent_enrollment_id, e.program_edition_id AS edition_num_id,')

const { rows: ediciones } = await q(`
  SELECT pe.edition_num_id AS id, pe.specific_code AS nombre, pe.start_date,
         p.program_name AS programa, cs.alias AS segmento
    FROM program_editions pe
    JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN programs p          ON p.program_id = pv.program_id
    LEFT JOIN catalog cs     ON cs.catalog_id = pe.cat_segment
   WHERE pe.active = 'Y' AND pe.start_date >= $1
   ORDER BY pe.start_date, pe.edition_num_id`, [DESDE])

const ids = ediciones.map(e => e.id)
const { rows } = await q(`${cte})
  SELECT enrollment_id, parent_enrollment_id, edition_num_id, comm_bucket, is_leaf, is_beca_leaf
    FROM roster`, [ids])

const CANALES = new Set(['VENTAS', 'SEGUI', 'MEMB', 'B2B'])
const porEdicion = new Map(ediciones.map(e => [e.id, { ...e, aula: 0, ven: 0, seg: 0, mem: 0, b2b: 0, bec: 0, desfases: [] }]))

for (const r of rows) {
  const ed = porEdicion.get(r.edition_num_id)
  const enAula = r.is_leaf && !r.is_beca_leaf
  const enCanal = CANALES.has(r.comm_bucket)
  if (enAula) ed.aula++
  if (r.comm_bucket === 'VENTAS') ed.ven++
  if (r.comm_bucket === 'SEGUI') ed.seg++
  if (r.comm_bucket === 'MEMB') ed.mem++
  if (r.comm_bucket === 'B2B') ed.b2b++
  if (r.comm_bucket === 'BECA') ed.bec++
  if (enAula === enCanal) continue
  ed.desfases.push({
    enrollment_id: r.enrollment_id,
    parent: r.parent_enrollment_id,
    bucket: r.comm_bucket,
    delta: enAula ? +1 : -1,
    razon: razonar(r, enAula)
  })
}

// Las dos unicas causas legitimas de descuadre (documentadas en el repo):
// el 1er curso de un paquete (asiste, su venta vive en el padre) y el padre
// mismo (es la venta, no asiste a ningun aula). Cualquier otra = bug.
function razonar (r, enAula) {
  if (enAula && r.comm_bucket === null) return 'OK 1er curso de paquete (venta en el padre)'
  if (!enAula && !r.is_leaf) return 'OK padre/diploma (venta, no asiste)'
  if (enAula && r.comm_bucket === 'BECA') return 'BUG beca comercial que no es beca en el aula'
  if (!enAula && r.is_beca_leaf) return 'BUG beca en el aula clasificada como canal'
  return 'BUG descuadre sin causa conocida'
}

let malas = 0
for (const ed of porEdicion.values()) {
  const suma = ed.ven + ed.seg + ed.mem + ed.b2b
  const bugs = ed.desfases.filter(d => d.razon.startsWith('BUG'))
  if (suma === ed.aula && !bugs.length) continue
  malas++
  const fecha = ed.start_date.toISOString().slice(0, 10)
  console.log(`\n#${ed.id} ${fecha} ${ed.programa} / ${ed.nombre}${ed.segmento === 'we_segment_a5' ? ' [A5 CANCELADA]' : ''}`)
  console.log(`   VEN ${ed.ven}  SEG ${ed.seg}  B2B ${ed.b2b}  MEM ${ed.mem}  = ${suma}   AULA ${ed.aula}   (BEC ${ed.bec})   diff ${ed.aula - suma}`)
  for (const d of ed.desfases) {
    console.log(`   ${d.delta > 0 ? '+1 aula' : '-1 aula'}  #${d.enrollment_id}${d.parent ? ` (hijo de ${d.parent})` : ''} bucket=${d.bucket ?? 'NULL'} :: ${d.razon}`)
  }
}

// Chequeo CRUZADO padre <-> hijo: el 1er curso de un paquete suma AULA aqui y
// su venta tiene que estar contada en la fila del padre. Si el padre no aparece
// en NINGUN canal, ese alumno esta en el aula y su venta en ninguna parte: es el
// descuadre que se ve al sumar la fila del diploma + la del 1er curso.
const primerosCurso = rows.filter(r => r.comm_bucket === null && r.is_leaf && !r.is_beca_leaf && r.parent_enrollment_id)
const { rows: edicionesPadre } = await q(
  'SELECT DISTINCT program_edition_id AS id FROM enrollments WHERE enrollment_id = ANY($1::int[])',
  [primerosCurso.map(r => r.parent_enrollment_id)])
const { rows: rosterPadres } = await q(`${cte})
  SELECT enrollment_id, comm_bucket FROM roster`, [edicionesPadre.map(e => e.id)])
const ventasContadas = new Set(rosterPadres.filter(r => CANALES.has(r.comm_bucket)).map(r => r.enrollment_id))

const huerfanos = primerosCurso.filter(r => !ventasContadas.has(r.parent_enrollment_id))
if (huerfanos.length) {
  console.log('\nASISTEN AL AULA PERO SU VENTA NO SE CUENTA EN NINGUNA FILA:')
  for (const h of huerfanos) console.log(`   aula ${h.edition_num_id}: #${h.enrollment_id} (su venta es #${h.parent_enrollment_id})`)
}
console.log(`=== ${primerosCurso.length} 1er-curso de paquete revisados | ${huerfanos.length} sin su venta en ninguna fila ===`)

const totalBugs = [...porEdicion.values()].flatMap(e => e.desfases).filter(d => d.razon.startsWith('BUG'))
console.log(`\n=== ${ediciones.length} ediciones desde ${DESDE} | ${malas} con AULA != VEN+SEG+B2B+MEM | ${totalBugs.length} desfases sin causa legitima ===`)
await pool.end()
