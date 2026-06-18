import ExcelJS from 'exceljs'
import { Readable } from 'node:stream'
import { DomainError } from '../../shared/errors.js'

// Fuentes de datos del modulo de importacion. Aisla DE DONDE vienen los bytes
// (archivo subido o Google Sheet por URL) y EN QUE formato (xlsx o csv), de la
// logica de mapeo. Devuelve siempre un ExcelJS.Workbook para que el resto del
// modulo trabaje con una sola abstraccion (worksheet/celdas).

// Carga un workbook desde un buffer. format: 'xlsx' | 'csv'. El CSV de Google
// ya viene con las formulas EVALUADAS (a diferencia del xlsx, que pierde el
// valor de formulas tipo IMPORTRANGE/VLOOKUP), por eso es la fuente preferida
// para hojas con columnas calculadas (ej. SALDO, TIPO DE MONEDA).
export async function loadWorkbook (buffer, format = 'xlsx') {
  const wb = new ExcelJS.Workbook()
  if (format === 'csv') {
    await wb.csv.read(Readable.from(buffer))
  } else {
    await wb.xlsx.load(buffer)
  }
  return wb
}

// Convierte una URL de Google Sheets a su URL de export CSV de la pestaña
// indicada por gid. Lanza DomainError si la URL no es una hoja reconocible.
export function googleSheetCsvUrl (url) {
  const idMatch = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(url || '')
  if (!idMatch) throw new DomainError('La URL no parece un Google Sheet valido.')
  const id = idMatch[1]
  // gid en query (?gid=) o en el hash (#gid=). Sin gid se asume la primera hoja.
  const gidMatch = /[?#&]gid=(\d+)/.exec(url)
  const gid = gidMatch ? gidMatch[1] : '0'
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`
}

// Descarga el CSV de un Google Sheet (por su URL normal) y lo carga como
// workbook. La hoja debe ser publica o compartida "cualquiera con el enlace".
export async function loadGoogleSheet (url) {
  const csvUrl = googleSheetCsvUrl(url)
  let res
  try {
    res = await fetch(csvUrl, { redirect: 'follow', signal: AbortSignal.timeout(30000) })
  } catch (err) {
    throw new DomainError(`No se pudo descargar el Google Sheet: ${err.message}`)
  }
  if (!res.ok) {
    throw new DomainError(`Google respondio ${res.status}. Verifica que la hoja sea publica o compartida por enlace.`)
  }
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('text/html')) {
    // Google devuelve HTML (pagina de login) cuando la hoja es privada.
    throw new DomainError('La hoja no es accesible por enlace (Google pidio inicio de sesion). Compartela como "cualquiera con el enlace" o sube el archivo.')
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  return loadWorkbook(buffer, 'csv')
}
