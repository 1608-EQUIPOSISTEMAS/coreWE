// Repara dos referencias que la copia para el ciclo 2027 dejó apuntando mal en
// '2. Objetivo Ing - Query'. Ambas venían de antes de esta actualización.
//
// 1. I60: el percentil que fija el techo del rango BAJO debe leer la temporalidad
//    del AÑO PROYECTADO. Al copiar el libro quedó en la fila 25 (Temporalidad 2026),
//    que está vacía a propósito porque el 2026 va a mitad de camino. Sin ese número
//    los tres rangos colapsan y las 12 severidades del escenario salen "ATÍPICO",
//    que es el margen más castigado (7% máx / 3% mín).
// 2. D75: 'Ingreso 2024' importaba de un libro que ya no responde. Ahora que el
//    histórico está congelado, lo toma de la fila 17 del mismo cuadro.
import { google } from 'googleapis'
import { createRequire } from 'node:module'

const OFIC27 = '1xXixIXR9xJ-dJwQonLIGCEqwcLbC8X_dVjivoUg9hMA'
const OBJETIVO = "'2. Objetivo Ing - Query'"

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
      { range: `${OBJETIVO}!I60`, values: [['=PERCENTILE(D26:O26;0,3)']] },
      { range: `${OBJETIVO}!D75`, values: [['=ARRAYFORMULA(D17:O17)']] },
    ],
  },
})
console.log(`Referencias reparadas: ${data.totalUpdatedCells}`)

// 3. Fila 68: las 12 severidades (ALTO/MEDIO/BAJO/ATÍPICO) que gobiernan el margen
//    de cada mes leían la misma fila 25 vacía. Cada mes tiene sus propios umbrales
//    escritos a mano, así que se reapunta la referencia sin tocar los cortes.
const sheets = google.sheets({ version: 'v4', auth })
const FILA_TEMPORALIDAD_PROYECTADA = 26

const severidades = (
  await sheets.spreadsheets.values.get({
    spreadsheetId: OFIC27,
    range: `${OBJETIVO}!D68:O68`,
    valueRenderOption: 'FORMULA',
  })
).data.values[0]

const reapuntadas = severidades.map((formula) =>
  formula.replace(/([D-O])25\b/g, `$1${FILA_TEMPORALIDAD_PROYECTADA}`),
)

const { data: fila68 } = await sheets.spreadsheets.values.update({
  spreadsheetId: OFIC27,
  range: `${OBJETIVO}!D68:O68`,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: [reapuntadas] },
})
console.log(`Severidades reapuntadas: ${fila68.updatedCells}`)
