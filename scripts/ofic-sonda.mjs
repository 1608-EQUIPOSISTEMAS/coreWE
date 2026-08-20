// Sonda de los libros OBJETIVOS FINANCIEROS (OFIC). Uso:
//   node scripts/ofic-sonda.mjs <libro> tabs
//   node scripts/ofic-sonda.mjs <libro> "'2. Objetivo Ing - Query'!A1:Q40" [FORMULA]
//   node scripts/ofic-sonda.mjs <libro> fuentes   -> libros externos que alimentan el libro (IMPORTRANGE) y si hay acceso
// <libro>: alias (ofic26 | ofic27) o un fileId de Drive.
import { google } from 'googleapis'
import { createRequire } from 'node:module'

const ALIAS = {
  ofic26: '16qPgCL3D5jU1AUntN0ieCj5ruyqthA8WacMUKv_v5_I', // OBJETIVOS FINANCIEROS 2026 - OFIC-26
  ofic27: '1xXixIXR9xJ-dJwQonLIGCEqwcLbC8X_dVjivoUg9hMA', // copia para el ciclo 2027
}

const [libro, comando, render = 'FORMATTED_VALUE'] = process.argv.slice(2)
const spreadsheetId = ALIAS[libro] || libro
const key = createRequire(import.meta.url)('../credentials/service.json')
const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/drive.metadata.readonly',
  ],
})
const sheets = google.sheets({ version: 'v4', auth })
const drive = google.drive({ version: 'v3', auth })

if (comando === 'tabs') await listarPestanas()
else if (comando === 'fuentes') await listarFuentes()
else await volcarRango(comando)

async function listarPestanas() {
  const { data } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'properties.title,sheets.properties' })
  const { capabilities } = (await drive.files.get({ fileId: spreadsheetId, fields: 'capabilities/canEdit' })).data
  console.log(`${data.properties.title}  (canEdit: ${capabilities.canEdit})`)
  for (const { properties: p } of data.sheets) {
    console.log(`${p.sheetId}\t${p.index}\t${p.title}\t${p.gridProperties.rowCount}x${p.gridProperties.columnCount}${p.hidden ? '\tOCULTA' : ''}`)
  }
}

async function volcarRango(range) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: render })
  ;(data.values || []).forEach((fila, i) => console.log(`${i + 1}| ${fila.join(' | ')}`))
}

async function listarFuentes() {
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId,
    includeGridData: true,
    fields: 'sheets(properties.title,data.rowData.values.userEnteredValue.formulaValue)',
  })
  const usos = new Map()
  for (const hoja of data.sheets) {
    for (const fila of hoja.data?.[0]?.rowData || []) {
      for (const celda of fila.values || []) {
        const f = celda.userEnteredValue?.formulaValue
        if (!f?.includes('IMPORTRANGE')) continue
        const id = f.match(/spreadsheets\/d\/([\w-]+)/)?.[1]
        if (!id) continue
        if (!usos.has(id)) usos.set(id, new Set())
        usos.get(id).add(`${hoja.properties.title} ← ${f.match(/;\s*"([^"]+)"/)?.[1] || '?'}`)
      }
    }
  }
  for (const [id, refs] of usos) {
    let titulo
    try {
      titulo = (await drive.files.get({ fileId: id, fields: 'name' })).data.name
    } catch (e) {
      titulo = `SIN ACCESO (${e.code})`
    }
    console.log(`\n${id}\n  ${titulo}`)
    for (const r of refs) console.log(`    · ${r}`)
  }
}
