// Desglose de UNA aula: de donde sale cada uno de los inscritos que cuenta la
// columna AULA del cronograma y en que fila esta su venta.
//
// Mismo truco que verificar-aula-vs-canales.mjs: el SQL sale del repositorio
// (stub de db que captura el query), no se reimplementa.
//
// Uso: node scripts/aula-detalle.mjs <edition_num_id>
import { q, pool } from './db.mjs'
import { EditionRepository } from '../src/modules/edition/edition.repository.js'

const EDICION = Number(process.argv[2])
if (!EDICION) { console.error('falta el edition_num_id'); process.exit(1) }

let sql = null
await new EditionRepository({ query: (text) => { sql = text; return { rows: [] } } })
  .classroomChannelMetricsList([])

const cte = sql
  .slice(0, sql.lastIndexOf(')\n    SELECT'))
  .replace('e.program_edition_id AS edition_num_id,',
           'e.enrollment_id, e.parent_enrollment_id, e.program_edition_id AS edition_num_id,')

const { rows } = await q(`${cte})
  SELECT r.enrollment_id, r.comm_bucket, r.is_leaf, r.is_beca_leaf,
         r.parent_enrollment_id,
         par.program_edition_id AS edicion_venta,
         ppar.program_name      AS programa_padre,
         pepar.specific_code    AS ed_padre,
         TRIM(CONCAT_WS(' ', per.last_name, per.mother_last_name, per.first_name)) AS alumno
    FROM roster r
    JOIN public.enrollments e ON e.enrollment_id = r.enrollment_id
    JOIN public.customers cust ON cust.customer_id = e.customer_id
    JOIN public.persons per ON per.person_id = cust.person_id
    LEFT JOIN public.enrollments par ON par.enrollment_id = r.parent_enrollment_id
    LEFT JOIN public.program_editions pepar ON pepar.edition_num_id = par.program_edition_id
    LEFT JOIN public.program_versions pvpar ON pvpar.program_version_id = pepar.program_version_id
    LEFT JOIN public.programs ppar ON ppar.program_id = pvpar.program_id
   ORDER BY r.comm_bucket NULLS LAST, par.program_edition_id`, [[EDICION]])

const aula = rows.filter(r => r.is_leaf && !r.is_beca_leaf)
const propios = rows.filter(r => ['VENTAS', 'SEGUI', 'MEMB', 'B2B'].includes(r.comm_bucket))
console.log(`edicion ${EDICION}: AULA ${aula.length} | canales en ESTA fila ${propios.length} | becas ${rows.filter(r => r.comm_bucket === 'BECA').length}`)

// Los que asisten pero su venta esta en OTRA fila del cronograma (1er curso de
// un paquete): agrupados por la edicion del padre, que es donde hay que ir a
// buscar sus VEN/SEG/MEM/B2B.
const fuera = aula.filter(r => r.comm_bucket === null)
const porPadre = new Map()
for (const r of fuera) {
  const k = `${r.edicion_venta ?? 's/edicion'} · ${r.ed_padre ?? '?'} · ${r.programa_padre ?? '(padre sin edicion: E0)'}`
  porPadre.set(k, (porPadre.get(k) || 0) + 1)
}
console.log('\nasisten aqui pero su venta vive en otra fila (1er curso de paquete):')
for (const [k, n] of [...porPadre].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`)

const raros = rows.filter(r => (r.is_leaf && !r.is_beca_leaf) !== ['VENTAS', 'SEGUI', 'MEMB', 'B2B'].includes(r.comm_bucket) && r.comm_bucket !== null && !(r.comm_bucket === 'BECA' && r.is_beca_leaf))
if (raros.length) { console.log('\nDESFASES SIN CAUSA CONOCIDA:'); console.table(raros) }
await pool.end()
