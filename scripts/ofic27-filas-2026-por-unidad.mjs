// Agrega la fila de avance real 2026 en los 4 bloques de "II. Cuadro de ingresos
// por marca" de '3. Avance U.Neg', que solo llegaban hasta el real 2025.
//
// La fila va DEBAJO del real 2025 y ENCIMA de Participación/Temporalidad, para que
// esas fórmulas sigan apuntando al 2025: un año con 7 meses no puede alimentar una
// temporalidad. Sheets reajusta solo las referencias que se corren.
//
// Correr UNA vez: insertar filas no es idempotente. El guard de abajo aborta si ya
// existe la fila, así que re-ejecutarlo es inofensivo.
import { google } from 'googleapis'
import { createRequire } from 'node:module'

const OFIC27 = '1xXixIXR9xJ-dJwQonLIGCEqwcLbC8X_dVjivoUg9hMA'
const AVANCE = "'3. Avance U.Neg'"
const AVANCE_SHEET_ID = 878064846
const FLUJO_2026 = '1lHKqXmJtifLoecSPtomZjBcTG6qkslxGsAeIFHftZec'
const MARGEN_2026 = "'2. MARGEN POR UNIDAD DE NEGOCIO 2026'"

// Fila del real 2025 de cada unidad (numeración previa a cualquier inserción) y su
// fila espejo en el libro de Contabilidad. Ojo: allá el orden es EN VIVO, FUNDACIÓN,
// ONLINE, B2B — no coincide con el del OFIC.
const UNIDADES = [
  { nombre: 'WE EDUCACIÓN EJECUTIVA', filaReal2025: 71, rangoOrigen: 'E6:P6' },
  { nombre: 'WE ONLINE', filaReal2025: 80, rangoOrigen: 'E8:P8' },
  { nombre: 'WE For BUSINESS', filaReal2025: 86, rangoOrigen: 'E9:P9' },
  { nombre: 'WE Foundation', filaReal2025: 92, rangoOrigen: 'E7:P7' },
]

// Un mes cuenta como cerrado cuando el ingreso total del grupo ya existe (fila 38).
// Sin esta máscara, los ceros de Fundación en abril y julio —que son reales— se
// verían igual que los meses que Contabilidad todavía no cierra.
const importarUnidad = (rangoOrigen) =>
  `=ARRAYFORMULA(IF($D$38:$O$38="";"";IMPORTRANGE("${FLUJO_2026}";"${MARGEN_2026}!${rangoOrigen}")))`

const key = createRequire(import.meta.url)('../credentials/service.json')
const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})
const sheets = google.sheets({ version: 'v4', auth })

const bloques = (
  await sheets.spreadsheets.values.get({
    spreadsheetId: OFIC27,
    range: `${AVANCE}!B66:B100`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  })
).data.values

if (bloques.some(([celda]) => celda === 2026)) {
  console.log('Las filas de avance 2026 por unidad ya existen. Nada que hacer.')
  process.exit(0)
}

// De abajo hacia arriba: así las filas ancla de los bloques de más arriba no se corren.
await sheets.spreadsheets.batchUpdate({
  spreadsheetId: OFIC27,
  requestBody: {
    requests: [...UNIDADES].reverse().map(({ filaReal2025 }) => ({
      insertDimension: {
        range: { sheetId: AVANCE_SHEET_ID, dimension: 'ROWS', startIndex: filaReal2025, endIndex: filaReal2025 + 1 },
        inheritFromBefore: true,
      },
    })),
  },
})

const filasNuevas = UNIDADES.map((unidad, i) => ({ ...unidad, fila: unidad.filaReal2025 + 1 + i }))

const { data } = await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: OFIC27,
  requestBody: {
    valueInputOption: 'USER_ENTERED',
    data: filasNuevas.map(({ fila, rangoOrigen }) => ({
      range: `${AVANCE}!A${fila}:D${fila}`,
      values: [['Avance a Jul', 2026, `=SUM(D${fila}:O${fila})`, importarUnidad(rangoOrigen)]],
    })),
  },
})

for (const { nombre, fila } of filasNuevas) console.log(`${nombre}: fila ${fila}`)
console.log(`Celdas escritas: ${data.totalUpdatedCells}`)
