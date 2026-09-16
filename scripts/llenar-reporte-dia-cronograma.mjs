// Llena la pestana "Reporte consultas - ventas 2" del libro "Reporte de Consultas - 2026":
// una matriz programa x dia con # Consultas, # Ventas e ingresos (s/.).
//
// Las filas (72 programas en orden TOP / NUEVO / NORMAL / BAJO) ya las dejo
// Planeamiento; vienen de "2. Clas. prog." del libro de Planificacion. Este
// script solo arma las columnas: un bloque de 3 por dia, encadenados desde D5.
//
//   node scripts/llenar-reporte-dia-cronograma.mjs --dry   # imprime, no escribe
//   node scripts/llenar-reporte-dia-cronograma.mjs
import { google } from 'googleapis'

const SPREADSHEET_ID = '1-jVpfSWYuRnwSxNNiJnpMqyMS3GADWSu39bLPDgalPY'
const SHEET_ID = 1954839919
const SHEET_TITLE = 'Reporte consultas - ventas 2'

const PRIMERA_FILA = 7
const ULTIMA_FILA = 78
const FILA_TOTAL = ULTIMA_FILA + 1
const PRIMERA_COLUMNA = 3 // D, base 0
const DIAS = 31

const esSimulacro = process.argv.includes('--dry')
const esVerificacion = process.argv.includes('--verificar')

const letraColumna = (i) => {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const columnaDelDia = (dia) => PRIMERA_COLUMNA + dia * 3
const celdaFecha = (dia) => letraColumna(columnaDelDia(dia)) + '$5'

// El nombre del programa llega a las hojas fuente con o sin sufijo de version
// ("DIP SUPPLY" y "DIP SUPPLY V3" son el mismo programa), asi que cada metrica
// suma dos criterios. El comodin no puede ser suelto: "POWER BI *" se comeria
// "POWER BI PRESENCIAL", que es otra fila del reporte; por eso exige el " V".
// Y no sirve pasar {"", " V*"} como criterio: sin ARRAYFORMULA, COUNTIFS
// reduce el arreglo a su primer elemento y las versiones se pierden en silencio.
const sumaConVersiones = (armarCriterio) => `=${armarCriterio('')}+${armarCriterio('&" V*"')}`

const formulaConsultas = (fila, dia) =>
  sumaConVersiones(
    (version) =>
      `COUNTIFS(Consultas!$F:$F,$B${fila}${version},Consultas!$A:$A,${celdaFecha(dia)},Consultas!$N:$N,"<>Indiferente")`
  )

const formulaVentas = (fila, dia) =>
  sumaConVersiones((version) => `COUNTIFS(Ventas!$Q:$Q,$B${fila}${version},Ventas!$D:$D,${celdaFecha(dia)})`)

const formulaIngresos = (fila, dia) =>
  sumaConVersiones(
    (version) => `SUMIFS(Ventas!$M:$M,Ventas!$Q:$Q,$B${fila}${version},Ventas!$D:$D,${celdaFecha(dia)})`
  )

const porDia = (armarBloque) => Array.from({ length: DIAS }, (_, dia) => armarBloque(dia)).flat()

const filaEncabezadoBloques = () => porDia(() => ['# Consultas', '# Ventas', 's/.'])

const filaSubencabezados = () => porDia(() => ['total consult', 'total ventas', 'total s/. ventas'])

// D5 es el ancla editable: el reporte arranca en el primer dia del mes en curso
// y cada bloque siguiente es el dia anterior + 1. Cambiar D5 mueve la ventana entera.
const filaFechas = () =>
  porDia((dia) => [
    dia === 0 ? '=EOMONTH(TODAY(),-1)+1' : `=${letraColumna(columnaDelDia(dia - 1))}5+1`,
    '',
    '',
  ])

const filaPrograma = (fila) =>
  porDia((dia) => [formulaConsultas(fila, dia), formulaVentas(fila, dia), formulaIngresos(fila, dia)])

const filaTotales = () =>
  porDia((dia) =>
    [0, 1, 2].map((metrica) => {
      const col = letraColumna(columnaDelDia(dia) + metrica)
      return `=SUM(${col}$${PRIMERA_FILA}:${col}$${ULTIMA_FILA})`
    })
  )

function construirMatriz () {
  const filas = [filaEncabezadoBloques(), filaFechas(), filaSubencabezados()]
  for (let fila = PRIMERA_FILA; fila <= ULTIMA_FILA; fila++) filas.push(filaPrograma(fila))
  filas.push(filaTotales())
  return filas
}

const anchoNecesario = () => columnaDelDia(DIAS - 1) + 3

async function ensancharHoja (sheets, columnasActuales) {
  const faltan = anchoNecesario() - columnasActuales
  if (faltan <= 0) return
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{ appendDimension: { sheetId: SHEET_ID, dimension: 'COLUMNS', length: faltan } }],
    },
  })
  console.log(`  + ${faltan} columnas (tenia ${columnasActuales}, necesita ${anchoNecesario()})`)
}

// La pestana se copio del reporte por edicion, que traia celdas combinadas en
// las filas 4 y 5. Escribir sobre una combinacion guarda la esquina y TIRA el
// resto sin dar error: asi se perdieron ocho columnas de encabezado en la
// primera pasada. Hay que descombinar antes de escribir.
const peticionDescombinar = () => ({
  unmergeCells: {
    range: {
      sheetId: SHEET_ID,
      startRowIndex: 3,
      endRowIndex: FILA_TOTAL,
      startColumnIndex: PRIMERA_COLUMNA,
      endColumnIndex: anchoNecesario(),
    },
  },
})

// 6.700 formulas largas no entran en una sola llamada comoda: se manda por tandas.
async function escribirPorTandas (sheets, matriz, primeraFilaHoja, filasPorTanda = 20) {
  const ultimaColumna = letraColumna(anchoNecesario() - 1)
  for (let i = 0; i < matriz.length; i += filasPorTanda) {
    const tanda = matriz.slice(i, i + filasPorTanda)
    const desde = primeraFilaHoja + i
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_TITLE}'!${letraColumna(PRIMERA_COLUMNA)}${desde}:${ultimaColumna}${desde + tanda.length - 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: tanda },
    })
  }
}

// Sin formato el ancla se ve como 46266 y los ingresos sin separador de miles.
function peticionesDeFormato () {
  return porDia((dia) => {
    const col = columnaDelDia(dia)
    return [
      {
        repeatCell: {
          range: { sheetId: SHEET_ID, startRowIndex: 4, endRowIndex: 5, startColumnIndex: col, endColumnIndex: col + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'd/mm' }, horizontalAlignment: 'CENTER' } },
          fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
        },
      },
      {
        repeatCell: {
          range: { sheetId: SHEET_ID, startRowIndex: PRIMERA_FILA - 1, endRowIndex: FILA_TOTAL, startColumnIndex: col + 2, endColumnIndex: col + 3 },
          cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      },
    ]
  })
}

async function main () {
  const alcance = esSimulacro || esVerificacion
    ? ['https://www.googleapis.com/auth/spreadsheets.readonly']
    : ['https://www.googleapis.com/auth/spreadsheets']
  const auth = new google.auth.GoogleAuth({ keyFile: 'credentials/service.json', scopes: alcance })
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() })

  const matriz = construirMatriz()
  const rango = `'${SHEET_TITLE}'!${letraColumna(PRIMERA_COLUMNA)}4:${letraColumna(anchoNecesario() - 1)}${FILA_TOTAL}`
  console.log(`${DIAS} dias x ${ULTIMA_FILA - PRIMERA_FILA + 1} programas -> ${rango}`)

  if (esSimulacro) {
    console.log('\nfila 4:', matriz[0].slice(0, 6).join(' | '))
    console.log('fila 5:', matriz[1].slice(0, 9).join(' | '))
    console.log('fila 6:', matriz[2].slice(0, 6).join(' | '))
    console.log('fila 7:')
    matriz[3].slice(0, 3).forEach((f) => console.log('  ' + f))
    console.log(`fila ${FILA_TOTAL}:`, matriz[matriz.length - 1].slice(0, 3).join(' | '))
    return
  }

  if (esVerificacion) return verificar(sheets)

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties' })
  const props = meta.data.sheets.map((s) => s.properties).find((s) => s.sheetId === SHEET_ID)
  await ensancharHoja(sheets, props.gridProperties.columnCount)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [peticionDescombinar()] },
  })

  // La pestana arrastra formulas muertas del reporte anterior (#REF! en AL:CA,
  // filas 48-59). Se limpia D4 hacia la derecha antes de escribir.
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_TITLE}'!${letraColumna(PRIMERA_COLUMNA)}4:${letraColumna(anchoNecesario() - 1)}`,
  })

  await escribirPorTandas(sheets, matriz, 4)

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_TITLE}'!B${FILA_TOTAL}`,
    valueInputOption: 'RAW',
    requestBody: { values: [['TOTAL']]  },
  })

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: peticionesDeFormato() },
  })

  console.log('escrito.')
  await verificar(sheets)
}

// Contrasta la fila de totales contra las hojas crudas: las consultas contra la
// pestana Consultas y las ventas contra el libro FICO (la fuente del IMPORTRANGE,
// que se cae seguido y deja la pestana Ventas en #REF! sin avisar).
const LIBRO_FICO = '1AFS8qoU_whFZw2KVQGJ2_MvZR8mYTZFqXO0BeX2f5aw'

const programaRaiz = (nombre) => String(nombre ?? '').trim().replace(/ V\d+$/, '')

async function verificar (sheets) {
  const leer = async (spreadsheetId, range) =>
    (await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'UNFORMATTED_VALUE' })).data
      .values || []

  const ultimaColumna = letraColumna(anchoNecesario() - 1)
  const reporte = await leer(
    SPREADSHEET_ID,
    `'${SHEET_TITLE}'!${letraColumna(PRIMERA_COLUMNA)}5:${ultimaColumna}${FILA_TOTAL}`
  )
  const programas = new Set(
    (await leer(SPREADSHEET_ID, `'${SHEET_TITLE}'!B${PRIMERA_FILA}:B${ULTIMA_FILA}`)).map((f) => f[0])
  )
  const consultas = await leer(SPREADSHEET_ID, 'Consultas!A2:N')
  const ventas = (await leer(LIBRO_FICO, '1. Ventas!A8:AI20000')).filter(
    (v) => v[0] && v[9] !== 'S/ARP' && v[18] !== 'RP' && v[10] !== 'BECA'
  )

  const fechas = reporte[0] || []
  const totales = reporte[reporte.length - 1] || []
  let descuadres = 0

  for (let dia = 0; dia < DIAS; dia++) {
    const i = dia * 3
    const fecha = Number(fechas[i])
    if (!fecha) continue
    const esperado = {
      consultas: consultas.filter(
        (c) =>
          Number(c[0]) === fecha &&
          String(c[13] ?? '').toLowerCase() !== 'indiferente' &&
          programas.has(programaRaiz(c[5]))
      ).length,
      ventas: ventas.filter((v) => Number(v[3]) === fecha && programas.has(programaRaiz(v[27]))),
    }
    const ingresoEsperado = esperado.ventas.reduce((suma, v) => suma + (Number(v[13]) || 0), 0)
    const obtenido = [Number(totales[i]) || 0, Number(totales[i + 1]) || 0, Number(totales[i + 2]) || 0]
    const cuadra =
      obtenido[0] === esperado.consultas &&
      obtenido[1] === esperado.ventas.length &&
      Math.abs(obtenido[2] - ingresoEsperado) < 0.5
    if (!cuadra) descuadres++
    console.log(
      `  ${cuadra ? 'OK ' : '!! '}${new Date(Date.UTC(1899, 11, 30 + fecha)).toISOString().slice(0, 10)}` +
        `  consultas ${obtenido[0]}/${esperado.consultas}` +
        `  ventas ${obtenido[1]}/${esperado.ventas.length}` +
        `  s/. ${obtenido[2].toFixed(0)}/${ingresoEsperado.toFixed(0)}`
    )
  }
  console.log(descuadres ? `${descuadres} dias descuadrados (hoja/esperado)` : 'todos los dias cuadran')
}

await main()
