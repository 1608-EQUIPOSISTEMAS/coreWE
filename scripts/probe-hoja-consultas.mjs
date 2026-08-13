// Sondeo de la hoja "Reporte de Consultas - 2026" para entender la pestana
// que gerencia pide replicar (la de DIVISION). Solo lectura.
//
//   node scripts/probe-hoja-consultas.mjs                    -> lista las pestanas
//   node scripts/probe-hoja-consultas.mjs <gid> [desde] [hasta]
import { google } from 'googleapis'

const SPREADSHEET_ID = '1-jVpfSWYuRnwSxNNiJnpMqyMS3GADWSu39bLPDgalPY'

const auth = new google.auth.GoogleAuth({
  keyFile: 'credentials/service.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
})
const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() })

const { data } = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
const pestanas = data.sheets.map(s => s.properties)

const gid = process.argv[2] ? Number(process.argv[2]) : null
if (gid === null) {
  for (const p of pestanas) console.log(`${p.sheetId}\t${p.title}\t${p.gridProperties.rowCount}x${p.gridProperties.columnCount}`)
  process.exit(0)
}

const pestana = pestanas.find(p => p.sheetId === gid)
if (!pestana) throw new Error(`No existe la pestana gid=${gid}`)

const desde = Number(process.argv[3] || 1)
const hasta = Number(process.argv[4] || desde + 44)

const { data: valores } = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `'${pestana.title}'!A${desde}:CZ${hasta}`,
})
console.log(`== ${pestana.title} (gid ${gid}) filas ${desde}-${hasta} ==`)
for (const [i, fila] of (valores.values || []).entries()) {
  console.log(String(desde + i).padStart(3), '|', (fila || []).join(' | '))
}
