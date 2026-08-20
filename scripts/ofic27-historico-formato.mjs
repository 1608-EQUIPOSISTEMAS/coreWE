// Las columnas nuevas de '4. Ing. Historico' heredaron el formato de su vecina
// (porcentaje en el cuadro II, sin separador de miles en el cuadro IV).
import { google } from 'googleapis'
import { createRequire } from 'node:module'

const OFIC27 = '1xXixIXR9xJ-dJwQonLIGCEqwcLbC8X_dVjivoUg9hMA'
const HISTORICO_SHEET_ID = 1327189695

// [primeraFila, ultimaFila, columna, patron] en numeración de la hoja.
const PORCENTAJE = '0%'
const NUEVOS = [
  [47, 50, 'N', PORCENTAJE], // cuadro II: aporte de cada línea sobre el total
  [47, 50, 'M'], // cuadro II: totales por línea de negocio
  [75, 87, 'O'], // cuadro IV: WE ZOOM
  [94, 106, 'O'], // WE ONLINE
  [113, 125, 'O'], // WE FUNDACIÓN
  [132, 144, 'O'], // WE FOR BUSINESS
]

const key = createRequire(import.meta.url)('../credentials/service.json')
const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})

await google.sheets({ version: 'v4', auth }).spreadsheets.batchUpdate({
  spreadsheetId: OFIC27,
  requestBody: {
    requests: NUEVOS.map(([desde, hasta, columna, patron]) => ({
      repeatCell: {
        range: {
          sheetId: HISTORICO_SHEET_ID,
          startRowIndex: desde - 1,
          endRowIndex: hasta,
          startColumnIndex: columna.charCodeAt(0) - 'A'.charCodeAt(0),
          endColumnIndex: columna.charCodeAt(0) - 'A'.charCodeAt(0) + 1,
        },
        cell: { userEnteredFormat: { numberFormat: patron === PORCENTAJE ? { type: 'PERCENT', pattern: patron } : { type: 'NUMBER', pattern: '#,##0' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    })),
  },
})
console.log(`Formato unificado en ${NUEVOS.length} rangos nuevos`)
