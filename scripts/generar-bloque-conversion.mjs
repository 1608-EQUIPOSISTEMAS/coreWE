// Bloque H:J de la hoja "2. Clas. prog." (Ventas | Consultas | Conversion),
// en el ORDEN DE LAS FILAS de la hoja, listo para pegar en H6.
//
// Ventas y consultas van como valor, no como BUSCARV: la hoja ya tiene sus
// gemelas en D y E pegadas asi, y dos criterios distintos en la misma pestana
// se terminan contradiciendo. La conversion SI es formula (=H/I) para que
// siga cuadrando si alguien corrige un numero a mano.
//
// El orden de la hoja se lee de un archivo aparte porque no es alfabetico ni
// deducible: Planeamiento agrupa por linea de negocio. Si la hoja cambia de
// filas hay que regenerar ese archivo, o el bloque se pega corrido.
import fs from 'node:fs'

const [RUTA_ORDEN, RUTA_VENTAS, RUTA_CONSULTAS] = process.argv.slice(2)
const PRIMERA_FILA = 6

const normalizar = nombre => nombre.replace(/\s+/g, ' ').trim().toUpperCase()

const indexarPorPrograma = (ruta, valorDe) => new Map(
  fs.readFileSync(ruta, 'utf8').split('\n')
    .filter(linea => linea.includes(';') && !linea.startsWith('PROGRAMA;'))
    .map(linea => linea.split(';'))
    .map(campos => [normalizar(campos[0]), valorDe(campos)])
)

const ventas = indexarPorPrograma(RUTA_VENTAS, campos => Number(campos[1]))
const consultas = indexarPorPrograma(RUTA_CONSULTAS, campos => Number(campos[1]))

const programas = fs.readFileSync(RUTA_ORDEN, 'utf8').split('\n').filter(linea => linea.trim())

const filas = programas.map((programa, indice) => {
  const fila = PRIMERA_FILA + indice
  const v = ventas.get(normalizar(programa))
  const c = consultas.get(normalizar(programa))
  // Sin consultas no hay conversion que calcular: la celda queda vacia, que se
  // lee como "no hubo", no como cero.
  const conversion = v && c ? `=SI.ERROR(H${fila}/I${fila};"")` : ''
  return [v ?? '', c ?? '', conversion].join('\t')
})

fs.writeFileSync(process.argv[5] ?? 'bloque-conversion.tsv', filas.join('\n'))

const conAmbos = programas.filter(p => ventas.get(normalizar(p)) && consultas.get(normalizar(p)))
const totalVentas = conAmbos.reduce((a, p) => a + ventas.get(normalizar(p)), 0)
const totalConsultas = conAmbos.reduce((a, p) => a + consultas.get(normalizar(p)), 0)
console.error(`-- ${filas.length} filas (H${PRIMERA_FILA}:J${PRIMERA_FILA + filas.length - 1}), ${conAmbos.length} con venta y consulta`)
console.error(`-- ${totalVentas} ventas / ${totalConsultas} consultas = ${(100 * totalVentas / totalConsultas).toFixed(1)}% de conversion global`)
