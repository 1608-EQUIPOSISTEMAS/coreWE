// Lee las hojas FICO del Google Sheet real y muestra las filas de los correos
// dados: la prueba de que un sync dejo al alumno (y su monto) donde corresponde,
// sin fiarse de lo que devuelve la query.
//   cd Backend && node scripts/probe-sheet-fico-correos.mjs correo1 correo2 ...
import { integrationRepository as repo } from '../src/modules/integration/integration.repository.js'

const HOJAS = ['0. Ventas Sistemas', '1. Aula Sistemas', '2. Consolidado']
const correos = process.argv.slice(2).map(c => c.toLowerCase())

const sheets = await repo.sheets()
for (const hoja of HOJAS) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: repo.SPREADSHEET.fico, range: `'${hoja}'!A1:AZ`
  })
  const [header, ...filas] = data.values ?? []
  const hits = filas.filter(f => f.some(celda => correos.includes(String(celda).trim().toLowerCase())))
  console.log(`\n== ${hoja}: ${hits.length} filas`)
  for (const f of hits) {
    console.log(Object.fromEntries(header.map((h, i) => [h, f[i]]).filter(([, v]) => v !== undefined && v !== '')))
  }
}
