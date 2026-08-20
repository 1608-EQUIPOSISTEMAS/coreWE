// Agrega el 2026 en '4. Ing. Historico', que se quedaba en el cierre 2025.
//
// Todo sale de '3. Avance U.Neg', que es donde vive el único enlace vivo al Flujo de
// Caja 2026. Nada se vuelve a importar: una sola celda del libro habla con Contabilidad.
//
// Los cuadros I y III llevan el año en FILAS, así que ahí se insertan filas. Los cuadros
// II y IV lo llevan en COLUMNAS y no se puede insertar ninguna: esas mismas columnas son
// los meses Ene-Dic de los cuadros de arriba, y correrlas rompería el resto de la hoja.
// Por eso el 2026 de esos dos se escribe en las columnas libres de la derecha.
//
// Correr UNA vez: inserta filas. El guard aborta si ya están.
import { google } from 'googleapis'
import { createRequire } from 'node:module'

const OFIC27 = '1xXixIXR9xJ-dJwQonLIGCEqwcLbC8X_dVjivoUg9hMA'
const HISTORICO = "'4. Ing. Historico'"
const HISTORICO_SHEET_ID = 1327189695
const AVANCE = "'3. Avance U.Neg'"

// Filas de '3. Avance U.Neg' donde ya está cargado el 2026 real.
const TOTAL_2026 = 40
const UNIDADES_2026 = { zoom: 74, online: 84, business: 91, fundacion: 98 }

const MESES = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O']

// Los meses sin cerrar llegan vacíos; propagarlos como 0 haría ver una caída.
const desdeAvance = (fila) =>
  `=ARRAYFORMULA(IF(${AVANCE}!D${fila}:O${fila}="";"";${AVANCE}!D${fila}:O${fila}))`

const desdeAvanceEnColumna = (fila) =>
  `=ARRAYFORMULA(TRANSPOSE(IF(${AVANCE}!D${fila}:O${fila}="";"";${AVANCE}!D${fila}:O${fila})))`

const key = createRequire(import.meta.url)('../credentials/service.json')
const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})
const sheets = google.sheets({ version: 'v4', auth })

const anios = (
  await sheets.spreadsheets.values.get({
    spreadsheetId: OFIC27,
    range: `${HISTORICO}!B9:B64`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  })
).data.values.flat()
if (anios.includes(2026)) {
  console.log('El 2026 ya está en 4. Ing. Historico. Nada que hacer.')
  process.exit(0)
}

// De abajo hacia arriba para que las filas ancla de más arriba no se corran.
// Cuadro III: una fila por unidad, bajo su 2025. Cuadro I: el 2026 y su tasa mensual.
const INSERCIONES = [
  { tras: 62, cuantas: 1 }, // WE FOR BUSINESS 2025 -> nueva 63
  { tras: 58, cuantas: 1 }, // WE ONLINE 2025     -> nueva 59
  { tras: 54, cuantas: 1 }, // WE ZOOM 2025       -> nueva 55
  { tras: 14, cuantas: 1 }, // Tasa Crec 24-25    -> nueva 15
  { tras: 12, cuantas: 1 }, // Ingresos 2025      -> nueva 13
]

await sheets.spreadsheets.batchUpdate({
  spreadsheetId: OFIC27,
  requestBody: {
    requests: INSERCIONES.map(({ tras, cuantas }) => ({
      insertDimension: {
        range: { sheetId: HISTORICO_SHEET_ID, dimension: 'ROWS', startIndex: tras, endIndex: tras + cuantas },
        inheritFromBefore: true,
      },
    })),
  },
})

// Numeración después de las 5 inserciones.
const CUADRO_I_2026 = 13
const CUADRO_I_TASA = 16
const CUADRO_III = { zoom: 57, online: 62, business: 67 }
const CUADRO_II_TOTAL = 'M'
const CUADRO_II_APORTE = 'N'
const CUADRO_II_FILAS = { zoom: 47, online: 48, fundacion: 49, business: 50 }
const CUADRO_IV_COLUMNA = 'O'
// Fila de Enero de cada tabla de detalle; la cabecera va una arriba y el total 12 abajo.
const CUADRO_IV = { zoom: 75, online: 94, fundacion: 113, business: 132 }

const cambios = [
  // Cuadro I: ingresos anuales totales del grupo.
  { range: `${HISTORICO}!B${CUADRO_I_2026}:D${CUADRO_I_2026}`, values: [[
    2026,
    `=SUM(E${CUADRO_I_2026}:P${CUADRO_I_2026})`,
    // Sin el año cerrado, una tasa anual contra el 2025 completo solo mide los meses que faltan.
    `=IF(COUNT(E${CUADRO_I_2026}:P${CUADRO_I_2026})<12;"";(C${CUADRO_I_2026}-C12)/C12)`,
  ]] },
  { range: `${HISTORICO}!E${CUADRO_I_2026}`, values: [[desdeAvance(TOTAL_2026)]] },
  { range: `${HISTORICO}!B${CUADRO_I_TASA}`, values: [['Tasa Crecimiento 25-26']] },
  { range: `${HISTORICO}!E${CUADRO_I_TASA}:P${CUADRO_I_TASA}`, values: [
    MESES.map((_, i) => {
      const col = String.fromCharCode('E'.charCodeAt(0) + i)
      return `=IF(${col}${CUADRO_I_2026}="";"";(${col}${CUADRO_I_2026}-${col}12)/${col}12)`
    }),
  ] },

  // Cuadro III: crecimiento por unidad y por mes.
  ...Object.entries(CUADRO_III).map(([unidad, fila]) => ({
    range: `${HISTORICO}!B${fila}:E${fila}`,
    values: [[
      2026,
      `=AVERAGE(E${fila}:P${fila})`,
      `=SUM(E${fila}:P${fila})`,
      desdeAvance(UNIDADES_2026[unidad]),
    ]],
  })),

  // Cuadro II: aporte por línea de negocio. Va a la derecha porque las columnas
  // del año son las mismas que los meses de los cuadros I y III.
  { range: `${HISTORICO}!${CUADRO_II_TOTAL}45:${CUADRO_II_APORTE}46`, values: [
    ['2026 (a Jul)', ''],
    ['Totales', 'Aporte'],
  ] },
  ...Object.entries(CUADRO_II_FILAS).map(([unidad, fila]) => ({
    range: `${HISTORICO}!${CUADRO_II_TOTAL}${fila}:${CUADRO_II_APORTE}${fila}`,
    values: [[
      `=${AVANCE}!C${UNIDADES_2026[unidad]}`,
      `=${CUADRO_II_TOTAL}${fila}/SUM(${CUADRO_II_TOTAL}$47:${CUADRO_II_TOTAL}$50)`,
    ]],
  })),

  // Cuadro IV: las 4 tablas de detalle mensual, misma razón para ir a la derecha.
  ...Object.entries(CUADRO_IV).flatMap(([unidad, filaEnero]) => [
    { range: `${HISTORICO}!${CUADRO_IV_COLUMNA}${filaEnero - 1}`, values: [['2026 (a Jul)']] },
    { range: `${HISTORICO}!${CUADRO_IV_COLUMNA}${filaEnero}`, values: [[desdeAvanceEnColumna(UNIDADES_2026[unidad])]] },
    { range: `${HISTORICO}!${CUADRO_IV_COLUMNA}${filaEnero + 12}`, values: [[`=SUM(${CUADRO_IV_COLUMNA}${filaEnero}:${CUADRO_IV_COLUMNA}${filaEnero + 11})`]] },
  ]),
]

const { data } = await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: OFIC27,
  requestBody: { valueInputOption: 'USER_ENTERED', data: cambios },
})
console.log(`4. Ing. Historico: ${data.totalUpdatedCells} celdas en ${cambios.length} rangos`)

// La columna nueva del cuadro II heredó formato de porcentaje de su vecina.
await sheets.spreadsheets.batchUpdate({
  spreadsheetId: OFIC27,
  requestBody: {
    requests: [
      {
        repeatCell: {
          range: { sheetId: HISTORICO_SHEET_ID, startRowIndex: 46, endRowIndex: 50, startColumnIndex: 12, endColumnIndex: 13 },
          cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      },
    ],
  },
})
console.log('Formato del cuadro II corregido')
