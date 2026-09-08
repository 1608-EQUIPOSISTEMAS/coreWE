// Genera las formulas ARRAYFORMULA que llenan el bloque "2026 (Ventas)"
// (columnas AN:AQ) de la hoja "Copia de OBJ VACANTES 26".
//
// Se resuelve por VLOOKUP contra el nombre del programa (columna A) y no
// escribiendo fila por fila a proposito: un desfase de una sola fila pondria
// los promedios en el programa equivocado, y ese error es invisible.
//
// El documento tiene locale espanol, asi que dentro de la formula:
//   ;  separa argumentos y filas del array literal
//   \  separa columnas del array literal
//   ,  es el separador decimal
import fs from 'node:fs'

const RUTA_CSV = process.argv[2]

// Se usa VLOOKUP celda a celda y NO ARRAYFORMULA: la version con array falla
// entera con #REF! en cuanto UNA celda del rango de expansion tiene contenido
// (las filas 15 y 16 repiten el encabezado Apertura/Seguimiento dentro de
// AN:AQ). Con la formula por celda, se pega el rango completo y punto.
//
// AN es la columna 40 y le toca el indice 2 de la tabla, de ahi el -38: al
// copiar a la derecha, COLUMN() da 3, 4 y 5 para AO, AP y AQ.
const DESPLAZAMIENTO_COLUMNA = 38

const enEspanol = valor => (valor === '' ? '""' : String(valor).replace('.', ','))

const filasDelCsv = csv =>
  csv.split('\n')
    .filter(linea => linea.includes(';') && !linea.startsWith('CURSO;'))
    .map(linea => linea.split(';'))
    // columnas del CSV: curso, apeAlta, n, apeNormal, n, segAlta, n, segNormal, n
    .map(([curso, apeAlta, , apeNormal, , segAlta, , segNormal, , observacion]) =>
      `"${curso}"\\${enEspanol(apeAlta)}\\${enEspanol(apeNormal)}\\${enEspanol(segAlta)}\\${enEspanol(segNormal)}\\"${observacion ?? ''}"`)

const tabla = `{${filasDelCsv(fs.readFileSync(RUTA_CSV, 'utf8')).join(';')}}`

// TRIM sobre el nombre porque la hoja tiene programas escritos con espacios de
// mas ("ROBOTIZ.  UIPATH" lleva dos): sin esto el VLOOKUP no encuentra la fila
// y la deja vacia, que se lee como "no tuvo ediciones" en vez de como un fallo.
const formula = `=IFERROR(VLOOKUP(TRIM($A10);${tabla};COLUMN()-${DESPLAZAMIENTO_COLUMNA};0);"")`
fs.writeFileSync('formula-AN10.txt', formula)
console.log(`formula-AN10.txt (${formula.length} caracteres)`)
console.log('Pegar en AN10 y copiar sobre AN10:AQ14 y AN17:AQ120.')
console.log('La observacion es el indice 6: va en AS con la misma formula.')
