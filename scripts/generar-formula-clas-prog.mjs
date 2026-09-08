// Genera la formula para la hoja "2. Clas. prog." del libro de Planeamiento.
//
// Layout de esa hoja: los nombres de programa estan en C6:C129 y las columnas
// destino son D (Total ventas) y E (Total de ingresos). D es la columna 4 y le
// toca el indice 2 de la tabla, de ahi el desplazamiento 2.
import fs from 'node:fs'
import { construirFormulaVlookup } from './lib/formula-vlookup.mjs'

const RUTA_CSV = process.argv[2]
const COLUMNA_ANCLA = 'C'
const PRIMERA_FILA = 6
const DESPLAZAMIENTO_COLUMNA = 2

const filas = fs.readFileSync(RUTA_CSV, 'utf8')
  .split('\n')
  .filter(linea => linea.includes(';') && !linea.startsWith('PROGRAMA;'))
  .map(linea => linea.split(';'))

const formula = construirFormulaVlookup({
  filas, columnaAncla: COLUMNA_ANCLA, primeraFila: PRIMERA_FILA, desplazamiento: DESPLAZAMIENTO_COLUMNA
})

fs.writeFileSync('formula-clas-prog.txt', formula)
console.log(`formula-clas-prog.txt (${formula.length} caracteres, ${filas.length} programas)`)
console.log('Pegar en D6 y copiar sobre D6:E129.')
