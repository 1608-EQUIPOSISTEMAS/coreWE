// Construye la formula de BUSCARV que se pega en una hoja del libro de
// Planeamiento para volcar datos calculados aqui.
//
// El documento tiene locale espanol, asi que dentro de la formula:
//   ;  separa argumentos y filas del array literal
//   \  separa columnas del array literal
//   ,  es el separador decimal
//
// Se usa VLOOKUP celda a celda y NO ARRAYFORMULA: la version con array falla
// entera con #REF! en cuanto UNA celda del rango de expansion tiene contenido,
// y esas hojas repiten encabezados en medio de los datos.
//
// TRIM sobre el nombre porque hay programas escritos con espacios de mas
// ("ROBOTIZ.  UIPATH" lleva dos): sin el, el BUSCARV no encuentra la fila y la
// deja vacia, que se lee como "no tuvo ediciones" en vez de como un fallo.

const enEspanol = valor =>
  valor === '' || valor === null || valor === undefined
    ? '""'
    : (typeof valor === 'number' ? String(valor) : String(valor)).replace('.', ',')

const entradaDeTabla = ([clave, ...valores]) =>
  `"${clave}"\\${valores.map(v => (/^-?[\d.,]+$/.test(String(v)) ? enEspanol(v) : `"${v ?? ''}"`)).join('\\')}`

/**
 * @param {Array<Array>} filas  cada una [clave, ...valores] en el orden de las columnas destino
 * @param {string} columnaAncla columna de la hoja que tiene la clave, p.ej. 'A' o 'C'
 * @param {number} primeraFila  fila donde se pega la formula
 * @param {number} desplazamiento  COLUMN() - desplazamiento debe dar 2 en la primera columna destino
 */
export const construirFormulaVlookup = ({ filas, columnaAncla, primeraFila, desplazamiento }) =>
  `=IFERROR(VLOOKUP(TRIM($${columnaAncla}${primeraFila});{${filas.map(entradaDeTabla).join(';')}};COLUMN()-${desplazamiento};0);"")`
