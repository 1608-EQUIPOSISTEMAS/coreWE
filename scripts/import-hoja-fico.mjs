// Importa una pestaña de la hoja FICO reusando el módulo de importación del
// backend (mismo código que la UI /configuracion/importacion), pero desde CLI y
// contra la BD de producción por el túnel SSH.
//
// La fuente puede ser la URL de la pestaña o un CSV ya descargado. Para importar
// SIEMPRE se usa el CSV local: la columna SALDO de la hoja es una fórmula viva y
// entre dos descargas cambia, así que hay que congelar los bytes y validar e
// insertar exactamente los mismos (`commitUrl` re-descarga por diseño).
//
// Uso:
//   node Backend/scripts/import-hoja-fico.mjs "<url>" freeze salida.csv
//   node Backend/scripts/import-hoja-fico.mjs salida.csv preview
//   node Backend/scripts/import-hoja-fico.mjs salida.csv validate
//   node Backend/scripts/import-hoja-fico.mjs salida.csv commit --user=1
//
// freeze   = descarga el CSV de la pestaña a un archivo (no toca BD).
// preview  = solo parsea (no toca BD): muestra filas, montos y cuotas.
// validate = dry-run completo (resuelve edición/catálogos/asesor contra la BD).
// commit   = inserta de verdad. skipFollowup: sin correo, sin Odoo.
import { readFile, writeFile } from 'node:fs/promises'

const [source, mode = 'preview', ...rest] = process.argv.slice(2)
if (!source) { console.error('Falta la fuente (URL o ruta al CSV).'); process.exit(1) }
const isUrl = /^https?:\/\//.test(source)

// dotenv NO pisa variables ya presentes: basta con setear DATABASE_URL antes de
// importar cualquier módulo que abra el pool. Al 2026-07-24 el .env ya apunta al
// túnel (127.0.0.1:55432), así que PGPASSWORD solo hace falta si eso cambia.
if (process.env.PGPASSWORD) {
  process.env.DATABASE_URL = `postgresql://postgres:${encodeURIComponent(process.env.PGPASSWORD)}@127.0.0.1:55432/neondb`
  process.env.DATABASE_SSL = 'false'
}

const { loadGoogleSheet, loadWorkbook, googleSheetCsvUrl } = await import('../src/modules/importer/importer.sources.js')

if (mode === 'freeze') {
  const dest = rest[0]
  if (!isUrl || !dest) { console.error('freeze necesita una URL y un archivo destino.'); process.exit(1) }
  const res = await fetch(googleSheetCsvUrl(source), { redirect: 'follow' })
  if (!res.ok) { console.error(`Google respondio ${res.status}`); process.exit(1) }
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
  console.log('CSV congelado en', dest)
  process.exit(0)
}

// Workbook de trabajo: del CSV local (preferido) o de la URL en vivo.
const wb = isUrl ? await loadGoogleSheet(source) : await loadWorkbook(await readFile(source), 'csv')

if (mode === 'preview') {
  const { parseWorkbook } = await import('../src/modules/importer/importer.xlsx.js')
  const { getImporter } = await import('../src/modules/importer/importer.registry.js')
  const { rows } = await parseWorkbook(wb, getImporter('enrollment_fico'))
  console.log(`filas detectadas: ${rows.length}`)
  for (const { rowNumber, raw } of rows) {
    const plan = (raw._installments || [])
    const cuadra = Math.abs((raw.down_payment + plan.reduce((s, i) => s + i.amount, 0)) - raw.total_amount) < 0.01
    console.log([rowNumber, raw.document_number, raw.full_name, raw.edition, raw.payment_way,
      `total=${raw.total_amount}`, `inicial=${raw.down_payment}`,
      plan.map(i => `${i.due_date}:${i.amount}`).join(' '),
      cuadra ? '' : '<< NO CUADRA'].join(' | '))
  }
  process.exit(0)
}

// Cablea los puertos del importer (efecto de módulo del composition root).
await import('../src/buildApp.js')
const { validateFile, commitFile } = await import('../src/modules/importer/importer.usecases.js')

const userArg = rest.find(a => a.startsWith('--user='))
const userId = userArg ? Number(userArg.split('=')[1]) : null
if (mode === 'commit' && !userId) { console.error('commit requiere --user=<user_id>'); process.exit(1) }

// validateFile/commitFile esperan xlsx; el CSV de Google ya trae las fórmulas
// evaluadas, así que reempaquetarlo a xlsx en memoria no pierde ningún valor y
// evita tocar el código compartido para aceptar CSV por archivo.
const xlsx = Buffer.from(await wb.xlsx.writeBuffer())

const { results, summary } = mode === 'commit'
  ? await commitFile('enrollment_fico', xlsx, userId, null)
  : await validateFile('enrollment_fico', xlsx)

console.log(summary)
for (const r of results) {
  const quien = r.raw?.full_name ?? ''
  if (r.status === 'valid' || r.status === 'imported') {
    console.log(`fila ${r.rowNumber}: ${r.status}${r.id ? ` (id ${r.id})` : ''} - ${quien}`)
  } else {
    console.log(`fila ${r.rowNumber}: ${r.status} - ${quien} :: ${(r.errors || []).join(' | ')}`)
  }
}
process.exit(0)
