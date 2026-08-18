// Lista las pestanas del spreadsheet FICO (para no crear una duplicada por una
// tilde o un espacio de diferencia en el nombre).
//   node scripts/probe-hojas-fico.mjs
import 'dotenv/config'
import { integrationRepository as repo } from '../src/modules/integration/integration.repository.js'

const sheets = await repo.sheets()
const meta = await sheets.spreadsheets.get({ spreadsheetId: repo.SPREADSHEET.fico })
for (const s of meta.data.sheets) console.log(JSON.stringify(s.properties.title))
process.exit(0)
