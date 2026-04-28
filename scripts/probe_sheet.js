// scripts/probe_sheet.js
// POC — solo lectura. Lista pestanas del Sheet y muestra headers + primeras filas.
// Uso: node scripts/probe_sheet.js
//
// Requisitos:
//   1. Backend/credentials/service.json presente (service_account)
//   2. El Sheet compartido como Lector con el client_email del service account
//
// Que imprime:
//   - Pestanas disponibles
//   - Para "1. INS - N" y "2. Cuota INS - N": headers reales + primeras 5 filas
//   - Diagnostico basico (filas totales, columnas totales)

import { google } from 'googleapis'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SPREADSHEET_ID = '1p5KK0Ax8nCsT44gXNVMkw-hRU4VUlFWGFYlUGDd9g44'
const KEY_FILE = path.resolve(__dirname, '../credentials/service.json')

const TABS_TO_PROBE = ['1. INS - N', '2. Cuota INS - N']
const PREVIEW_ROWS = 5

async function getSheetsClient () {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  })
  const client = await auth.getClient()
  return google.sheets({ version: 'v4', auth: client })
}

async function listTabs (sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
  return meta.data.sheets.map(s => ({
    title: s.properties.title,
    rows: s.properties.gridProperties.rowCount,
    cols: s.properties.gridProperties.columnCount
  }))
}

async function readRange (sheets, tab, range = 'A1:ZZ') {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tab}'!${range}`
    })
    return res.data.values || []
  } catch (err) {
    if (err.code === 400) return null
    throw err
  }
}

function printPreview (tabName, rows) {
  console.log(`\n=== ${tabName} ===`)
  if (!rows || rows.length === 0) {
    console.log('  (vacia o pestana no encontrada)')
    return
  }
  const headers = rows[0]
  const data = rows.slice(1, 1 + PREVIEW_ROWS)
  console.log(`  filas: ${rows.length - 1} (excluyendo header)`)
  console.log(`  columnas: ${headers.length}`)
  console.log('\n  HEADERS:')
  headers.forEach((h, i) => console.log(`    ${String(i + 1).padStart(3)}. ${JSON.stringify(h)}`))
  console.log(`\n  PRIMERAS ${data.length} FILAS:`)
  data.forEach((row, idx) => {
    console.log(`\n  --- fila ${idx + 2} ---`)
    headers.forEach((h, i) => {
      const val = row[i] ?? ''
      if (val !== '') console.log(`    ${h}: ${JSON.stringify(val)}`)
    })
  })
}

async function main () {
  console.log(`Probing spreadsheet: ${SPREADSHEET_ID}`)
  console.log(`Key file: ${KEY_FILE}`)

  const sheets = await getSheetsClient()

  console.log('\n--- PESTANAS DISPONIBLES ---')
  const tabs = await listTabs(sheets)
  tabs.forEach(t => console.log(`  "${t.title}" (${t.rows} filas x ${t.cols} cols)`))

  for (const tabName of TABS_TO_PROBE) {
    const match = tabs.find(t => t.title === tabName)
    if (!match) {
      console.log(`\n=== ${tabName} ===\n  NO ENCONTRADA. Pestanas reales:`)
      tabs.forEach(t => console.log(`    - ${t.title}`))
      continue
    }
    const rows = await readRange(sheets, tabName)
    printPreview(tabName, rows)
  }

  console.log('\n--- OK ---')
}

main().catch(err => {
  console.error('\nERROR:', err.message)
  if (err.code === 403) {
    console.error('\nProbable causa: el Sheet no esta compartido con el service account.')
    console.error('Compartilo como Lector con: sistemas@sistemas-478920.iam.gserviceaccount.com')
  }
  if (err.code === 404) {
    console.error('\nProbable causa: Spreadsheet ID invalido o el service account no ve el archivo.')
  }
  process.exit(1)
})
