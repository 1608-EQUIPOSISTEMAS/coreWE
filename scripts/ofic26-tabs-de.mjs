// Sonda genérica: lista pestañas (gid, nombre, tamaño) de cualquier libro por ID.
import { google } from 'googleapis'
import { createRequire } from 'node:module'

const key = createRequire(import.meta.url)('../credentials/service.json')
const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
})
const sheets = google.sheets({ version: 'v4', auth })
const { data } = await sheets.spreadsheets.get({ spreadsheetId: process.argv[2], fields: 'properties.title,sheets.properties' })
console.log(data.properties.title)
for (const { properties: p } of data.sheets) {
  console.log(`${p.sheetId}\t${p.index}\t${p.title}\t${p.gridProperties.rowCount}x${p.gridProperties.columnCount}${p.hidden ? '\tOCULTA' : ''}`)
}
