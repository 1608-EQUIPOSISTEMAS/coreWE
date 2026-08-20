// Las filas nuevas heredaron el formato del real 2025, que en B2B y Fundación venía
// sin separador de miles y con 4 decimales. Se unifica solo en las filas agregadas.
import { google } from 'googleapis'
import { createRequire } from 'node:module'

const OFIC27 = '1xXixIXR9xJ-dJwQonLIGCEqwcLbC8X_dVjivoUg9hMA'
const AVANCE_SHEET_ID = 878064846
const FILAS_2026 = [72, 82, 89, 96]

const key = createRequire(import.meta.url)('../credentials/service.json')
const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})

await google.sheets({ version: 'v4', auth }).spreadsheets.batchUpdate({
  spreadsheetId: OFIC27,
  requestBody: {
    requests: FILAS_2026.map((fila) => ({
      repeatCell: {
        range: { sheetId: AVANCE_SHEET_ID, startRowIndex: fila - 1, endRowIndex: fila, startColumnIndex: 2, endColumnIndex: 15 },
        cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    })),
  },
})
console.log(`Formato unificado en las filas ${FILAS_2026.join(', ')}`)
