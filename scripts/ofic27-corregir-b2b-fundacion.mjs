// Corrige dos defectos de datos preexistentes en '4. Ing. Historico'.
//
// 1. Cuadro III, B2B enero 2024: tenía 35.242,94, que es al céntimo el enero 2025 de
//    la misma tabla. Se nota en su propia fila de T. Crecimiento, que marcaba 0,00%
//    en enero: imposible entre dos años distintos. Inflaba el 2024 de B2B en 2.540,20.
//    Los otros 11 meses y las demás unidades ya cotejan (ver ofic27-cotejar-cuadro-iii.mjs).
//
// 2. Cuadro II: las referencias al avance estaban cruzadas. Fundación leía el total de
//    B2B y viceversa, y ONLINE leía dos veces su 2025. Por eso el cuadro mostraba a
//    Fundación con 601.012 en 2025 y a B2B con 125.544.
import { google } from 'googleapis'
import { createRequire } from 'node:module'

const OFIC27 = '1xXixIXR9xJ-dJwQonLIGCEqwcLbC8X_dVjivoUg9hMA'
const HISTORICO = "'4. Ing. Historico'"
const AVANCE = "'3. Avance U.Neg'"

// Fila de cada unidad en '3. Avance U.Neg', por año.
const TOTAL_EN_AVANCE = {
  zoom: { 2024: 72, 2025: 73 },
  online: { 2024: 82, 2025: 83 },
  fundacion: { 2024: 96, 2025: 97 },
  business: { 2024: 89, 2025: 90 },
}
// Fila de cada unidad en el cuadro II. F = totales 2024, H = totales 2025.
const CUADRO_II = { zoom: 47, online: 48, fundacion: 49, business: 50 }

const key = createRequire(import.meta.url)('../credentials/service.json')
const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})

const { data } = await google.sheets({ version: 'v4', auth }).spreadsheets.values.batchUpdate({
  spreadsheetId: OFIC27,
  requestBody: {
    valueInputOption: 'USER_ENTERED',
    data: [
      { range: `${HISTORICO}!E65`, values: [[`=${AVANCE}!D${TOTAL_EN_AVANCE.business[2024]}`]] },
      ...Object.entries(CUADRO_II).flatMap(([unidad, fila]) => [
        { range: `${HISTORICO}!F${fila}`, values: [[`=${AVANCE}!C${TOTAL_EN_AVANCE[unidad][2024]}`]] },
        { range: `${HISTORICO}!H${fila}`, values: [[`=${AVANCE}!C${TOTAL_EN_AVANCE[unidad][2025]}`]] },
      ]),
    ],
  },
})
console.log(`Referencias corregidas: ${data.totalUpdatedCells}`)
