import { importerPorts } from '../importer.ports.js'
import { cellText, normText, buildHeaderIndex, findCol } from '../importer.xlsx.js'

// Adaptador "Hoja FICO": ingiere la planilla operativa real de FICO (pestaña
// "INS - N" de las hojas MBA/PEE/ESP/CURSOS) directamente desde el Google Sheet
// (CSV, con formulas evaluadas) o desde un .xlsx subido. Empareja columnas por
// ENCABEZADO (tolerante a las variantes entre tipos de programa) y reconstruye
// la inscripcion + el cronograma de cuotas (formato ancho FCn/Cn).
//
// FASE 1: inscripcion + cronograma (cuotas pendientes). La pestaña "Cuota INS-N"
// con el detalle de pagos por cuota es FASE 2.

// --- Alias de encabezado (las 4 hojas comparten el nucleo; difieren en N de
// cursos/cuotas y algun renombre). El emparejado es por estos alias. ---------
const H = {
  document_number: ['dni', 'documento'],
  full_name: ['nombres y apellidos'],
  email: ['correo'],
  phone: ['celular'],
  ocup: ['ocup'],
  edition: ['ed'],
  modality: ['modalidad'],
  currency: ['tipo de moneda', 'moneda'],
  payment_medium: ['medio de pago'],
  transaction_code: ['n° operacion', 'n operacion', 'numero operacion'],
  payment_date: ['f. pago', 'f pago'],
  down_payment: ['inicial'],
  ingreso: ['ingreso'],
  saldo: ['saldo']
}
const MAX_CUOTAS = 6 // FC1/C1 .. FC6/C6 (CURSOS llega a 5; sobran columnas se ignoran)

// --- Columnas logicas (para chequeo de obligatorios y previsualizacion) -----
// `key` debe coincidir con las claves que produce ingest().
const columns = [
  { key: 'document_number', header: 'Documento (DNI)', required: true },
  { key: 'full_name', header: 'Nombres y apellidos', required: true },
  { key: 'email', header: 'Correo', required: false },
  { key: 'phone', header: 'Celular', required: false },
  { key: 'edition', header: 'Edicion (ED)', required: true },
  { key: 'total_amount', header: 'Monto total', required: false },
  { key: 'payment_way', header: 'Forma de pago', required: false }
]

// --- Ingesta a medida: workbook -> { rows } --------------------------------
// Lee la pestaña de inscripciones, empareja por encabezado y emite filas con
// claves limpias + un array `_installments` (cronograma reconstruido de FCn/Cn).
function ingest (wb) {
  const ws = findInscriptionSheet(wb)
  if (!ws) throw new Error('No se encontro la pestaña de inscripciones (con columna DNI).')

  const headerRow = findHeaderRow(ws)
  const idx = buildHeaderIndex(ws, headerRow)
  const col = {}
  for (const key in H) col[key] = findCol(idx, H[key])

  // Indices de FCn (fecha) y Cn (monto) del cronograma ancho.
  const fc = []; const cn = []
  for (let n = 1; n <= MAX_CUOTAS; n++) {
    fc[n] = findCol(idx, ['fc' + n])
    cn[n] = findCol(idx, ['c' + n])
  }

  const rows = []
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return
    const documento = col.document_number ? cellText(row.getCell(col.document_number).value) : ''
    if (!documento) return // sin DNI no es una inscripcion (filas de relleno/totales)

    const get = (key) => col[key] ? cellText(row.getCell(col[key]).value) : ''
    const total = num(get('ingreso')) + num(get('saldo'))

    const installments = []
    for (let n = 1; n <= MAX_CUOTAS; n++) {
      if (!cn[n]) continue
      const amount = num(row.getCell(cn[n]).value)
      if (amount <= 0) continue
      installments.push({
        installment_number: n,
        amount,
        due_date: fc[n] ? cellText(row.getCell(fc[n]).value) : ''
      })
    }

    rows.push({
      rowNumber,
      raw: {
        document_number: documento,
        full_name: get('full_name'),
        email: get('email'),
        phone: get('phone'),
        ocup: get('ocup'),
        edition: get('edition'),
        modality: get('modality'),
        currency: get('currency'),
        payment_medium: get('payment_medium'),
        transaction_code: get('transaction_code'),
        payment_date: get('payment_date'),
        down_payment: num(get('down_payment')),
        total_amount: total,
        // Forma de pago inferida: si hay cuotas en el cronograma es "cuotas".
        payment_way: installments.length > 0 ? 'cuotas' : 'contado',
        _installments: installments
      }
    })
  })

  return { rows }
}

// Encuentra la pestaña de inscripciones: la primera cuyo encabezado contiene DNI.
// (CSV trae una sola hoja; el .xlsx descargado trae todas — "1. INS - N" etc.)
function findInscriptionSheet (wb) {
  for (const ws of wb.worksheets) {
    if (findHeaderRow(ws, true) !== null) return ws
  }
  return null
}

// Localiza la fila de encabezado (la que contiene "DNI"/"DOCUMENTO") en las
// primeras filas. Devuelve el numero de fila, o null si no la encuentra.
function findHeaderRow (ws, probeOnly = false) {
  const limit = Math.min(8, ws.rowCount || 8)
  for (let r = 1; r <= limit; r++) {
    let found = false
    ws.getRow(r).eachCell((cell) => {
      const t = normText(cell.value)
      if (t === 'dni' || t === 'documento') found = true
    })
    if (found) return r
  }
  return probeOnly ? null : 1
}

// =============================================================================
// resolveRow — CONTRIBUCION DEL USUARIO (resolucion de IDs de dominio)
// =============================================================================
// La EXTRACCION ya esta hecha y probada: `raw` trae campos limpios y
// `installments` el cronograma. Falta traducir nombres/codigos a IDs:
//   1. CATEGORY_ALIASES: alias exactos de catalogo (confirmar con cataloglist).
//   2. ED -> edicion/programa: via puerto findEditionByCode (cablearlo en
//      buildApp con el query real que matchea la columna ED del sistema).
async function resolveRow (raw, ctx, installments = []) {
  const errors = []
  const { firstName, lastName } = splitName(raw.full_name)
  const data = {
    document_number: raw.document_number ? String(raw.document_number).trim() : null,
    first_name: firstName,
    last_name: lastName,
    email: raw.email || null,
    phone: raw.phone ? String(raw.phone).trim() : null,
    total_amount: raw.total_amount || 0,
    list_price: raw.total_amount || 0,
    saved_money: raw.down_payment || 0,
    transaction_code: raw.transaction_code || null,
    payment_date: normalizeDate(raw.payment_date),
    observations: 'Importacion masiva FICO (hoja)',
    is_scholarship: false,
    // OCUP -> perfil de cliente (determinista, sin catalogo).
    client_profile: profileFromOcup(raw.ocup)
  }

  // Cronograma (ya viene reconstruido y limpio).
  if (installments.length > 0) {
    data.installment_plan = installments
      .map(c => ({
        installment_number: Number(c.installment_number),
        amount: Number(c.amount),
        due_date: normalizeDate(c.due_date)
      }))
      .filter(c => c.installment_number && c.amount > 0 && c.due_date)
      .sort((a, b) => a.installment_number - b.installment_number)
  }

  // --- TODO 1: alias EXACTOS de catalogo (confirmar con cataloglist) ---------
  const CATEGORY_ALIASES = {
    modality: 'we_inscription_modality',
    currency: 'we_currency',
    paymentMedium: 'we_method_payment'
  }
  // Ejemplo (descomentar y ajustar):
  // const cur = matchCatalog(ctx.catalog, CATEGORY_ALIASES.currency, raw.currency)
  // if (cur) data.cat_currency = cur.id; else errors.push(`Moneda no reconocida: "${raw.currency}"`)
  // ...idem modality -> cat_insc_modality, payment_medium -> cat_payment_medium.

  // --- TODO 2: resolver ED -> edicion + programa via puerto ------------------
  if (importerPorts.findEditionByCode) {
    const ed = await importerPorts.findEditionByCode(raw.edition)
    if (ed) {
      data.program_edition_id = ed.program_edition_id
      data.program_version_id = ed.program_version_id
    } else {
      errors.push(`Edicion no encontrada en el sistema: "${raw.edition}"`)
    }
  } else {
    errors.push('Resolucion de edicion (ED) pendiente de cablear (findEditionByCode).')
  }

  return { data, errors }
}

// OCUP: P -> profesional, E -> estudiante (confirmado: no hay otros codigos).
function profileFromOcup (ocup) {
  const v = normText(ocup)
  if (v === 'e') return 'estudiante'
  if (v === 'p') return 'profesional'
  return null
}

// Parte "APELLIDOS NOMBRES" en last_name / first_name. Heuristica: los primeros
// 2 tokens son apellidos (convencion peruana); el resto, nombres. Con <=2 tokens
// reparte mitad y mitad. ES UNA SUPOSICION: si tu hoja usa otro orden, ajustala.
function splitName (full) {
  const tokens = String(full || '').trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { firstName: null, lastName: null }
  if (tokens.length === 1) return { firstName: null, lastName: tokens[0] }
  if (tokens.length === 2) return { firstName: tokens[1], lastName: tokens[0] }
  return { firstName: tokens.slice(2).join(' '), lastName: tokens.slice(0, 2).join(' ') }
}

function num (v) {
  const s = cellText(v)
  if (!s) return 0
  const n = Number(s.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// Normaliza fecha a 'YYYY-MM-DD'. Acepta ISO (xlsx -> Date) y el formato
// peruano D/M/AAAA o D-M-AAAA (CSV de Google -> texto). Devuelve null si no es
// interpretable.
function normalizeDate (value) {
  const s = cellText(value)
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s)
  if (m) {
    const [, d, mo, y] = m
    const dd = String(d).padStart(2, '0')
    const mm = String(mo).padStart(2, '0')
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) {
      return `${y}-${mm}-${dd}`
    }
  }
  return null
}

async function commitRow (data, { userId }) {
  const resp = await importerPorts.registerEnrollment({ data, userId })
  if (resp?.result === 1 && resp.enrollment_id) {
    return { ok: true, id: resp.enrollment_id, message: 'Inscripcion creada' }
  }
  if (resp?.result === 2) {
    return { ok: false, duplicate: true, message: resp.message || 'Inscripcion duplicada' }
  }
  return { ok: false, message: resp?.message || 'El registro no devolvio exito' }
}

// Contexto compartido (catalogos + programas), cargado una vez por archivo.
async function loadContext () {
  const [catalog, versionsPage] = await Promise.all([
    importerPorts.getCatalog(),
    importerPorts.listProgramVersions({ active: 'Y', size: 1000 })
  ])
  return { catalog, programVersions: versionsPage?.items ?? [] }
}

export const enrollmentFicoImporter = {
  key: 'enrollment_fico',
  label: 'Hoja FICO (Google Sheet)',
  description: 'Importa la pestaña "INS - N" de las hojas FICO (MBA/PEE/ESP/CURSOS) por URL o archivo.',
  templateFilename: 'hoja-fico.xlsx',
  acceptsUrl: true,
  columns,
  ingest,
  loadContext,
  resolveRow,
  commitRow
}
