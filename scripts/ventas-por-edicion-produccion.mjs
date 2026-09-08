// Contadores VENTAS/SEGUI por edicion, leidos de PRODUCCION (solo lectura).
//
// Existe porque la columna VENTAS del Sheet "Cronograma Vacantes 2026" esta
// caida de julio en adelante (julio marca 52 ventas y agosto 0, con aulas de
// 45 alumnos), y julio es mes alto: sin este dato el promedio de temporalidad
// alta sale hundido.
//
// Produccion se toca por DATABASE_URL, NUNCA exportando PGPASSWORD: eso ultimo
// parte los pools de scripts y backend en dos bases distintas sin avisar.
// El tunel SSH que levanta DBeaver se cae seguido, de ahi el reintento.
import fs from 'node:fs'
import pg from 'pg'
import { EditionRepository } from '../src/modules/edition/edition.repository.js'

const ANIO = Number(process.argv[2] ?? 2026)
const INTENTOS = 3

const urlDeProduccion = () =>
  fs.readFileSync('.env.bak-produccion', 'utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim()

async function conectarConReintento () {
  for (let intento = 1; intento <= INTENTOS; intento++) {
    const cliente = new pg.Client({ connectionString: urlDeProduccion(), connectionTimeoutMillis: 10000 })
    try {
      await cliente.connect()
      return cliente
    } catch (error) {
      await cliente.end().catch(() => {})
      if (intento === INTENTOS) throw new Error(`tunel SSH caido tras ${INTENTOS} intentos: ${error.message}`)
    }
  }
}

const cliente = await conectarConReintento()
const { rows: ediciones } = await cliente.query(`
  SELECT pe.edition_num_id, pe.specific_code,
         pe.start_date, EXTRACT(MONTH FROM pe.start_date)::int AS mes,
         pv.abbreviation AS curso
    FROM public.program_editions pe
    JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
   WHERE pe.active = 'Y'
     AND pe.start_date >= make_date($1, 1, 1)
     AND pe.start_date <  make_date($1 + 1, 1, 1)`, [ANIO])

const repo = new EditionRepository(cliente)
const metricas = await repo.classroomChannelMetricsList(ediciones.map(e => e.edition_num_id))
const porEdicion = new Map(metricas.map(m => [m.edition_num_id, m]))

const filas = ediciones.map(e => {
  const m = porEdicion.get(e.edition_num_id)
  return {
    curso: e.curso, edicion: e.specific_code,
    inicio: e.start_date.toISOString().slice(0, 10), mes: e.mes,
    // Sin fila de metricas la edicion no tiene un solo inscrito elegible: es
    // una venta de cero, no un dato faltante.
    ventas: m?.cnt_ventas ?? 0, segui: m?.cnt_segui ?? 0, aula: m?.cnt_aula ?? 0
  }
})

fs.writeFileSync(process.argv[3] ?? 'ventas-por-edicion.json', JSON.stringify(filas, null, 2))

const porMes = new Map()
for (const f of filas) {
  const m = porMes.get(f.mes) ?? { ediciones: 0, ventas: 0, segui: 0 }
  m.ediciones++; m.ventas += f.ventas; m.segui += f.segui
  porMes.set(f.mes, m)
}
console.log(`${filas.length} ediciones ${ANIO}`)
console.table([...porMes.keys()].sort((a, b) => a - b).map(mes => ({ mes, ...porMes.get(mes) })))
await cliente.end()
