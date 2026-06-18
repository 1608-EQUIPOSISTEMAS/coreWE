import { getImporter, listImporters } from './importer.registry.js'
import { buildTemplateWorkbook, parseWorkbook, linkKey } from './importer.xlsx.js'
import { loadWorkbook, loadGoogleSheet } from './importer.sources.js'
import { DomainError } from '../../shared/errors.js'

// Casos de uso del modulo de importacion. Orquestan el flujo generico (parsear
// -> validar -> confirmar) delegando lo especifico de cada entidad al importador
// del registry. La fuente (archivo o URL de Google Sheet) se resuelve a un
// workbook antes de entrar al nucleo comun.

const MAX_ROWS = 5000

export function getEntities () {
  return listImporters()
}

// Genera la plantilla Excel descargable de la entidad. Devuelve buffer + nombre.
export async function buildTemplate (entity) {
  const def = getImporter(entity)
  const buffer = await buildTemplateWorkbook(def)
  return { buffer, filename: def.templateFilename }
}

// --- Entradas (archivo o URL) ----------------------------------------------

export async function validateFile (entity, buffer) {
  return validateWorkbook(getImporter(entity), await loadWorkbook(buffer, 'xlsx'))
}

export async function commitFile (entity, buffer, userId) {
  return commitWorkbook(getImporter(entity), await loadWorkbook(buffer, 'xlsx'), userId)
}

export async function validateUrl (entity, url) {
  return validateWorkbook(getImporter(entity), await loadGoogleSheet(url))
}

export async function commitUrl (entity, url, userId) {
  return commitWorkbook(getImporter(entity), await loadGoogleSheet(url), userId)
}

// --- Nucleo comun (a partir de un workbook) --------------------------------

// Valida fila por fila (obligatorios genericos + resolucion de dominio) sin
// escribir nada. Es el "dry-run" que alimenta la previsualizacion.
async function validateWorkbook (def, wb) {
  const { rows, details } = await parseWorkbook(wb, def)
  guardRowCount(rows)

  const ctx = await def.loadContext()
  const used = new Set()
  const results = []
  for (const { rowNumber, raw } of rows) {
    results.push(await evaluateRow(def, raw, rowNumber, ctx, details, used))
  }
  results.push(...orphanDetailResults(def, details, used))

  return { results, summary: summarize(results) }
}

// Importa de verdad: re-parsea y re-valida (no confia en el cliente) y confirma
// SOLO las filas validas, una por una. Cada commit captura su error para no
// abortar el lote.
async function commitWorkbook (def, wb, userId) {
  const { rows, details } = await parseWorkbook(wb, def)
  guardRowCount(rows)

  const ctx = await def.loadContext()
  const used = new Set()
  const results = []
  for (const { rowNumber, raw } of rows) {
    const evaluated = await evaluateRow(def, raw, rowNumber, ctx, details, used)
    if (evaluated.status !== 'valid') {
      results.push({ ...evaluated, imported: false })
      continue
    }
    try {
      const outcome = await def.commitRow(evaluated.data, { userId })
      results.push({
        rowNumber,
        raw,
        imported: outcome.ok,
        status: outcome.ok ? 'imported' : (outcome.duplicate ? 'duplicate' : 'error'),
        errors: outcome.ok ? [] : [outcome.message],
        id: outcome.id ?? null
      })
    } catch (err) {
      results.push({ rowNumber, raw, imported: false, status: 'error', errors: [err.message] })
    }
  }
  results.push(...orphanDetailResults(def, details, used).map(r => ({ ...r, imported: false })))

  return { results, summary: summarize(results) }
}

// --- Internos --------------------------------------------------------------

function guardRowCount (rows) {
  if (rows.length === 0) throw new DomainError('El archivo no tiene filas con datos.')
  if (rows.length > MAX_ROWS) {
    throw new DomainError(`El archivo tiene ${rows.length} filas; el maximo por importacion es ${MAX_ROWS}.`)
  }
}

// Valida una fila: primero los obligatorios declarados en columns, luego la
// resolucion de dominio del importador. Si hay hoja de detalle, adjunta las
// filas de detalle enlazadas (y marca su clave como usada para detectar
// huerfanas despues). Acumula todos los errores para mostrarlos juntos.
async function evaluateRow (def, raw, rowNumber, ctx, details, used) {
  const errors = []

  for (const col of def.columns) {
    if (col.required && isEmpty(raw[col.key])) {
      errors.push(`Falta "${col.header}" (obligatorio).`)
    }
  }

  let detailRows = []
  if (def.detail && details) {
    const key = linkKey(raw[def.detail.linkTo])
    if (key !== null && details.has(key)) {
      detailRows = details.get(key).map(d => d.raw)
      used.add(key)
    }
  }

  let data = null
  if (errors.length === 0) {
    const resolved = await def.resolveRow(raw, ctx, detailRows)
    data = resolved.data
    errors.push(...(resolved.errors ?? []))
  }

  return {
    rowNumber,
    raw,
    data,
    status: errors.length === 0 ? 'valid' : 'error',
    errors
  }
}

// Filas de la hoja de detalle cuya clave de enlace no coincide con ninguna fila
// principal: se reportan como error para que el usuario no pierda cuotas en
// silencio. `used` trae las claves que si fueron consumidas por una inscripcion.
function orphanDetailResults (def, details, used) {
  if (!def.detail || !details) return []
  const out = []
  for (const [key, entries] of details) {
    if (used.has(key)) continue
    const first = entries[0]
    out.push({
      rowNumber: first.rowNumber,
      raw: first.raw,
      data: null,
      status: 'error',
      errors: [`En la hoja "${def.detail.sheet}" hay ${entries.length} fila(s) para "${first.raw[def.detail.linkColumn]}" sin inscripcion correspondiente en la hoja principal.`]
    })
  }
  return out
}

function isEmpty (value) {
  return value === null || value === undefined || String(value).trim() === ''
}

function summarize (results) {
  return results.reduce((acc, r) => {
    acc.total++
    if (r.status === 'imported') acc.imported++
    else if (r.status === 'duplicate') acc.duplicate++
    else if (r.status === 'valid') acc.valid++
    else acc.error++
    return acc
  }, { total: 0, valid: 0, imported: 0, duplicate: 0, error: 0 })
}
