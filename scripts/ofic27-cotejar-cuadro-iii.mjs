// Cruza el cuadro III de '4. Ing. Historico' contra '3. Avance U.Neg', que es la
// fuente. Los valores de allá están pegados a mano: enero 2024 de B2B resultó ser
// una copia del enero 2025, así que conviene revisar los 6 pares.
import { google } from 'googleapis'
import { createRequire } from 'node:module'

const OFIC27 = '1xXixIXR9xJ-dJwQonLIGCEqwcLbC8X_dVjivoUg9hMA'
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic']

const PARES = [
  { unidad: 'ZOOM 2024', historico: 55, avance: 72 },
  { unidad: 'ZOOM 2025', historico: 56, avance: 73 },
  { unidad: 'ONLINE 2024', historico: 60, avance: 82 },
  { unidad: 'ONLINE 2025', historico: 61, avance: 83 },
  { unidad: 'B2B 2024', historico: 65, avance: 89 },
  { unidad: 'B2B 2025', historico: 66, avance: 90 },
]

const key = createRequire(import.meta.url)('../credentials/service.json')
const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
})
const sheets = google.sheets({ version: 'v4', auth })

const { data } = await sheets.spreadsheets.values.batchGet({
  spreadsheetId: OFIC27,
  ranges: PARES.flatMap(({ historico, avance }) => [
    `'4. Ing. Historico'!E${historico}:P${historico}`,
    `'3. Avance U.Neg'!D${avance}:O${avance}`,
  ]),
  valueRenderOption: 'UNFORMATTED_VALUE',
})

const centimos = (n) => Math.round((n || 0) * 100)

for (const [i, { unidad }] of PARES.entries()) {
  const [enHistorico, enAvance] = [data.valueRanges[i * 2], data.valueRanges[i * 2 + 1]].map((r) => r.values[0])
  const discrepancias = MESES.map((mes, m) =>
    centimos(enHistorico[m]) === centimos(enAvance[m])
      ? null
      : `${mes}: histórico ${enHistorico[m]} vs avance ${enAvance[m]}`,
  ).filter(Boolean)
  console.log(discrepancias.length ? `${unidad}: ${discrepancias.join(' | ')}` : `${unidad}: OK`)
}
