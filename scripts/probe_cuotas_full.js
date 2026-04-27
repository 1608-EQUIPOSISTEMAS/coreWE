import { google } from 'googleapis'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SPREADSHEET_ID = '1p5KK0Ax8nCsT44gXNVMkw-hRU4VUlFWGFYlUGDd9g44'

const auth = new google.auth.GoogleAuth({
  keyFile: path.resolve(__dirname, '../credentials/service.json'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
})
const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() })

const res = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: "'2. Cuota INS - N'!A1:CZ5"
})
const rows = res.data.values
console.log('Total cols in row 1:', rows[0].length)
console.log('Total cols in row 2:', rows[1].length)
console.log('Total cols in row 3:', rows[2].length)

console.log('\nROW 1 (mega-header):')
rows[0].forEach((v, i) => { if (v) console.log(`  col ${i+1}: ${JSON.stringify(v)}`) })
console.log('\nROW 2 (sub-header):')
rows[1].forEach((v, i) => { if (v) console.log(`  col ${i+1}: ${JSON.stringify(v)}`) })
console.log('\nROW 3 (primer dato):')
rows[2].forEach((v, i) => { if (v) console.log(`  col ${i+1}: ${JSON.stringify(v)}`) })
