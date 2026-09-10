// Recalcula el cuadro de promedios a partir del --detalle que ya emitio
// promedio-ventas-apertura-seguimiento.mjs, sin volver a pedirle el volcado del
// cronograma a Drive ni consultar produccion.
//
// El detalle es la union exacta de las filas que entraron al calculo (mes<=8,
// cronograma hasta mayo y ERP de junio en adelante), asi que reprocesarlo da el
// mismo resultado. Comparte el clasificador con el script original: la regla de
// apertura/seguimiento vive en un solo sitio.
import fs from 'node:fs'
import { crearClasificador, temporalidad } from './lib/clasificacion-ediciones.mjs'

const [RUTA_DETALLE, RUTA_PAQUETES] = process.argv.slice(2)

const clasificar = crearClasificador(JSON.parse(fs.readFileSync(RUTA_PAQUETES, 'utf8')))

const filas = fs.readFileSync(RUTA_DETALLE, 'utf8').split('\n').slice(1)
  .filter(linea => linea.trim())
  .map(linea => {
    const [curso, edicion, inicio, , fuente, ventas, segui] = linea.split(';')
    return { curso, edicion, inicio, fuente, ventas: Number(ventas), segui: Number(segui) }
  })

const promedio = valores =>
  valores.length ? Number((valores.reduce((a, b) => a + b, 0) / valores.length).toFixed(1)) : null

const grupos = new Map()
for (const fila of filas) {
  const celda = `${clasificar(fila) === 'SEGUIMIENTO' ? 'SEG' : 'APE'}_${temporalidad(fila)}`
  if (!grupos.has(fila.curso)) {
    grupos.set(fila.curso, { APE_ALTA: [], APE_NORMAL: [], SEG_ALTA: [], SEG_NORMAL: [] })
  }
  grupos.get(fila.curso)[celda].push(fila.ventas)
}

const csv = ['CURSO;APERTURA ALTA;n;APERTURA NORMAL;n;SEGUIMIENTO ALTA;n;SEGUIMIENTO NORMAL;n']
for (const [curso, v] of [...grupos].sort((a, b) => a[0].localeCompare(b[0], 'es'))) {
  csv.push([curso,
    promedio(v.APE_ALTA), v.APE_ALTA.length,
    promedio(v.APE_NORMAL), v.APE_NORMAL.length,
    promedio(v.SEG_ALTA), v.SEG_ALTA.length,
    promedio(v.SEG_NORMAL), v.SEG_NORMAL.length].map(x => x ?? '').join(';'))
}
console.log(csv.join('\n'))
console.error(`\n-- ${filas.length} ediciones, ${grupos.size} cursos`)
