import ExcelJS from 'exceljs'

// Helpers de Excel para el modulo de importacion. Aislados de la logica de
// dominio: aqui solo se sabe de "columnas", "filas" y, opcionalmente, una hoja
// de detalle padre-hijo. No se sabe de inscripciones ni de cuotas.

const SHEET_INSTRUCCIONES = 'Instrucciones'
const DEFAULT_SHEET = 'Datos'

// Construye el workbook de plantilla a partir de la definicion del importador.
// Hoja principal (def.columns) + hoja de detalle opcional (def.detail) + hoja
// de Instrucciones que documenta ambas. Devuelve un Buffer listo para adjuntar.
export async function buildTemplateWorkbook (def) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'WE ERP'

  addDataSheet(wb, primarySheetName(def), def.columns)
  if (def.detail) addDataSheet(wb, def.detail.sheet, def.detail.columns)

  // NO se agregan filas de ejemplo en las hojas de datos: parseWorkbook trata
  // como dato toda fila tras el encabezado, asi que un ejemplo se importaria
  // como un registro falso. Los ejemplos viven en la hoja Instrucciones.
  addInstructionsSheet(wb, def)

  return wb.xlsx.writeBuffer()
}

// Parsea un workbook (ya cargado desde archivo o URL). Devuelve { rows, details }.
// Si el importador define `ingest(workbook)` (formato externo a medida, ej. la
// hoja FICO), delega en el; si no, usa el parseo POSICIONAL de la plantilla
// generada (columnas en el mismo orden).
//   - rows: filas de la hoja principal [{ rowNumber, raw }].
//   - details: si def.detail existe, Map(claveNormalizada -> [{ rowNumber, raw }])
//     agrupando las filas de detalle por su columna de enlace; null si no hay
//     hoja de detalle. La clave se normaliza para que el join no falle por
//     mayusculas/espacios.
export async function parseWorkbook (wb, def) {
  if (typeof def.ingest === 'function') {
    const result = await def.ingest(wb)
    return { rows: result.rows ?? [], details: result.details ?? null }
  }

  const primaryWs = wb.getWorksheet(primarySheetName(def)) || wb.worksheets[0]
  if (!primaryWs) throw new Error('El archivo no contiene hojas legibles')
  const rows = readSheet(primaryWs, def.columns)

  let details = null
  if (def.detail) {
    const detailWs = wb.getWorksheet(def.detail.sheet)
    details = new Map()
    if (detailWs) {
      for (const entry of readSheet(detailWs, def.detail.columns)) {
        const key = linkKey(entry.raw[def.detail.linkColumn])
        if (key === null) continue // sin clave de enlace: se ignora (validacion lo vera como huerfana)
        if (!details.has(key)) details.set(key, [])
        details.get(key).push(entry)
      }
    }
  }

  return { rows, details }
}

// Normaliza una clave de enlace (numero de documento) para el join padre-hijo.
export function linkKey (value) {
  if (value === null || value === undefined) return null
  const s = String(value).trim().toLowerCase()
  return s === '' ? null : s
}

// --- Internos --------------------------------------------------------------

function primarySheetName (def) {
  return def.primarySheet || DEFAULT_SHEET
}

// Agrega una hoja de datos con encabezado estilizado a partir de columnas.
function addDataSheet (wb, name, columns) {
  const ws = wb.addWorksheet(name)
  ws.columns = columns.map(col => ({
    header: col.required ? `${col.header} *` : col.header,
    key: col.key,
    width: Math.max(16, (col.header?.length ?? 0) + 4)
  }))
  const headerRow = ws.getRow(1)
  headerRow.font = { bold: true }
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9ECEF' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  headerRow.height = 22
  return ws
}

// Hoja de instrucciones: documenta cada columna de la hoja principal y, si
// existe, de la hoja de detalle (con un separador entre secciones).
function addInstructionsSheet (wb, def) {
  const help = wb.addWorksheet(SHEET_INSTRUCCIONES)
  help.columns = [
    { header: 'Hoja', key: 'sheet', width: 14 },
    { header: 'Columna', key: 'header', width: 28 },
    { header: 'Obligatoria', key: 'required', width: 12 },
    { header: 'Ejemplo', key: 'example', width: 20 },
    { header: 'Que colocar', key: 'help', width: 64 }
  ]
  help.getRow(1).font = { bold: true }

  const addColumnDocs = (sheetName, columns) => {
    columns.forEach(col => {
      help.addRow({
        sheet: sheetName,
        header: col.header,
        required: col.required ? 'Si' : 'No',
        example: col.example ?? '',
        help: col.help ?? ''
      })
    })
  }

  addColumnDocs(primarySheetName(def), def.columns)
  if (def.detail) {
    help.addRow({}) // separador visual
    if (def.detail.help) {
      const note = help.addRow({ sheet: def.detail.sheet, header: def.detail.help })
      note.font = { italic: true, color: { argb: 'FF475569' } }
    }
    addColumnDocs(def.detail.sheet, def.detail.columns)
  }
}

// Lee una hoja contra una lista de columnas. Mapea por POSICION (mismo orden
// que la plantilla), salta encabezado y filas totalmente vacias.
function readSheet (ws, columns) {
  const out = []
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return // encabezado
    const raw = {}
    let hasValue = false
    columns.forEach((col, idx) => {
      const value = normalizeCell(row.getCell(idx + 1)?.value)
      raw[col.key] = value
      if (value !== null && value !== '') hasValue = true
    })
    if (hasValue) out.push({ rowNumber, raw })
  })
  return out
}

// --- Helpers para ingesta por ENCABEZADO (formatos externos a medida) -------

// Texto plano de una celda (desenvuelve formula/hyperlink/richText/fecha).
export function cellText (value) {
  const v = normalizeCell(value)
  if (v === null) return ''
  if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, 10)
  return String(v).trim()
}

// Normaliza un texto para comparar encabezados/valores sin importar
// mayusculas, acentos ni espacios repetidos (incluye saltos de linea).
export function normText (value) {
  return cellText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

// Construye un indice { encabezadoNormalizado -> numeroDeColumna } de una fila.
export function buildHeaderIndex (ws, headerRowNumber = 1) {
  const index = {}
  ws.getRow(headerRowNumber).eachCell((cell, col) => {
    const key = normText(cell.value)
    if (key && index[key] == null) index[key] = col
  })
  return index
}

// Busca el numero de columna que corresponde a alguno de los alias dados.
export function findCol (headerIndex, aliases) {
  for (const a of aliases) {
    const key = normText(a)
    if (headerIndex[key] != null) return headerIndex[key]
  }
  return null
}

// Normaliza el valor de una celda de ExcelJS a un primitivo simple. ExcelJS
// devuelve objetos para formulas, hipervinculos, rich text y fechas; los
// aplanamos a string/number/Date para que el resolver no lidie con esa forma.
function normalizeCell (value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value
  if (typeof value === 'object') {
    if ('result' in value) return normalizeCell(value.result) // formula
    if ('text' in value) return String(value.text).trim() // hyperlink
    if ('richText' in value) return value.richText.map(t => t.text).join('').trim()
    return null
  }
  if (typeof value === 'string') return value.trim()
  return value
}
