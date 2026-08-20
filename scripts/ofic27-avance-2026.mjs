// Completa el 2026 en '3. Avance U.Neg': la cabecera de avance seguía midiendo el
// cierre 2025 y no existían las filas de temporalidad del año en curso.
//
// Correr UNA vez: inserta filas. El guard aborta si ya están.
import { google } from 'googleapis'
import { createRequire } from 'node:module'

const OFIC27 = '1xXixIXR9xJ-dJwQonLIGCEqwcLbC8X_dVjivoUg9hMA'
const AVANCE = "'3. Avance U.Neg'"
const AVANCE_SHEET_ID = 878064846

// Las dos filas nuevas van tras '% Temp 2025 Real' (fila 21); todo lo de abajo corre 2.
const FILA_TRAS_TEMP_2025 = 21
const CORRIMIENTO = 2
const correr = (fila) => fila + CORRIMIENTO

const PROY_2026 = correr(37)
const REAL_2026 = correr(38)
const MESES = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O']

const key = createRequire(import.meta.url)('../credentials/service.json')
const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})
const sheets = google.sheets({ version: 'v4', auth })

const rotulos = (
  await sheets.spreadsheets.values.get({ spreadsheetId: OFIC27, range: `${AVANCE}!A17:A25` })
).data.values.flat()
if (rotulos.some((rotulo) => rotulo?.includes('2026'))) {
  console.log('Las filas de temporalidad 2026 ya existen. Nada que hacer.')
  process.exit(0)
}

await sheets.spreadsheets.batchUpdate({
  spreadsheetId: OFIC27,
  requestBody: {
    requests: [
      {
        insertDimension: {
          range: { sheetId: AVANCE_SHEET_ID, dimension: 'ROWS', startIndex: FILA_TRAS_TEMP_2025, endIndex: FILA_TRAS_TEMP_2025 + CORRIMIENTO },
          inheritFromBefore: true,
        },
      },
    ],
  },
})

// La temporalidad real solo tiene sentido con el año cerrado: repartir 100% entre 7
// meses haría ver a enero con el 21% del año. La fórmula se activa sola en diciembre.
const temporalidadReal = (mes) =>
  `=IF(COUNT($D$${REAL_2026}:$O$${REAL_2026})<12;"";${mes}${REAL_2026}/$C$${REAL_2026})`

const { data } = await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: OFIC27,
  requestBody: {
    valueInputOption: 'USER_ENTERED',
    data: [
      // Cabecera: seguía leyendo el 2025 (filas 31/32 de entonces).
      { range: `${AVANCE}!A4:B6`, values: [
        ['3. Objetivo ingresos 2026', `=C${PROY_2026}`],
        ['4. Objetivo logrado a Jul', `=C${REAL_2026}`],
        ['4. % Avance del total', '=B5/B4'],
      ] },
      { range: `${AVANCE}!D8`, values: [['SEMESTRE I - 26']] },
      { range: `${AVANCE}!I8`, values: [['SEMESTRE II - 26']] },
      { range: `${AVANCE}!E10:G10`, values: [[
        `=SUM(D${PROY_2026}:I${PROY_2026})`,
        `=SUM(D${REAL_2026}:I${REAL_2026})`,
        '=E10-F10',
      ]] },
      { range: `${AVANCE}!J10:L10`, values: [[
        `=SUM(J${PROY_2026}:O${PROY_2026})`,
        `=SUM(J${REAL_2026}:O${REAL_2026})`,
        '=J10-K10',
      ]] },

      // Filas nuevas de temporalidad.
      { range: `${AVANCE}!A22:C22`, values: [['% Temp 2026 Proy', '%', '=SUM(D22:O22)']] },
      { range: `${AVANCE}!D22:O22`, values: [MESES.map((mes) => `=${mes}${PROY_2026}/$C$${PROY_2026}`)] },
      { range: `${AVANCE}!A23:C23`, values: [['% Temp 2026 Real', '%', '=SUM(D23:O23)']] },
      { range: `${AVANCE}!D23:O23`, values: [MESES.map(temporalidadReal)] },
    ],
  },
})
console.log(`Avance 2026: ${data.totalUpdatedCells} celdas`)
