// Invariante del cronograma: AULA = VENTAS + SEGUI + MEMB + B2B.
//
// Mover ventas de columna no puede romperla; lo unico que la rompe de forma
// legitima es el 1er curso de un paquete (suma AULA y su venta vive en la fila
// del padre) y el padre/diploma (es la venta y no asiste). Este script separa
// esas dos causas del resto.
//
// Uso: node scripts/verificar-invariante-aula.mjs [YYYY-MM-DD]  (default 2026-01-01)
import { q, pool } from './prod-db.mjs'
import { EditionRepository } from '../src/modules/edition/edition.repository.js'

const DESDE = process.argv[2] || '2026-01-01'

const { rows: ediciones } = await q(`
  SELECT pe.edition_num_id AS id, pe.specific_code, pv.abbreviation AS programa
    FROM program_editions pe
    JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
   WHERE pe.active = 'Y' AND pe.start_date >= $1`, [DESDE])

const repo = new EditionRepository({ query: q })
const filas = await repo.classroomChannelMetricsList(ediciones.map(e => e.id))

const sospechosas = []
for (const f of filas) {
  const canales = f.cnt_ventas + f.cnt_segui + f.cnt_memb + f.cnt_b2b
  if (canales !== f.cnt_aula) sospechosas.push({ ...f, canales, delta: f.cnt_aula - canales })
}

// Un desfase es legitimo si la edicion tiene 1er-cursos de paquete (suman AULA
// sin canal) o padres/diplomas (canal sin AULA). Se comprueba con el roster.
const cte = await (async () => {
  let sql = null
  await new EditionRepository({ query: (t) => { sql = t; return { rows: [] } } }).classroomChannelMetricsList([])
  return sql.slice(0, sql.lastIndexOf(')\n    SELECT'))
    .replace('e.program_edition_id AS edition_num_id,', 'e.enrollment_id, e.program_edition_id AS edition_num_id,')
})()

const { rows: roster } = await q(`${cte})
  SELECT edition_num_id, comm_bucket, is_leaf, is_beca_leaf FROM roster`, [sospechosas.map(f => f.edition_num_id)])

const causas = new Map()
for (const r of roster) {
  const c = causas.get(r.edition_num_id) ?? { primerCurso: 0, padres: 0 }
  // Suma AULA pero no canal: hoja no-beca sin canal (1er curso de un paquete).
  if (r.comm_bucket === null && r.is_leaf && !r.is_beca_leaf) c.primerCurso++
  // Suma canal pero no AULA: el padre/diploma es la venta y no asiste. Solo los
  // cuatro canales entran en la invariante; BECA no suma en ninguno de los dos.
  if (['VENTAS', 'SEGUI', 'MEMB', 'B2B'].includes(r.comm_bucket) && !r.is_leaf) c.padres++
  causas.set(r.edition_num_id, c)
}

const sinExplicacion = sospechosas.filter(f => {
  const c = causas.get(f.edition_num_id) ?? { primerCurso: 0, padres: 0 }
  return f.delta !== c.primerCurso - c.padres
})

console.log(`Ediciones revisadas: ${filas.length}`)
console.log(`Filas con AULA != suma de canales: ${sospechosas.length} (1er curso de paquete / padre-diploma)`)
console.log(sinExplicacion.length
  ? `\nBUG — desfases sin causa legitima (${sinExplicacion.length}):\n` + JSON.stringify(sinExplicacion.slice(0, 10), null, 2)
  : '\nOK: todos los desfases se explican por 1er curso de paquete o padre/diploma.')

await pool.end()
