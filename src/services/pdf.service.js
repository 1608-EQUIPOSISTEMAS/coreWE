import PDFDocument from 'pdfkit'
import path from 'path'
import { fileURLToPath } from 'url'
import { getCatalog } from '../modules/catalog/catalog.usecases.js'
import { pool } from '../config/db.js'
import { callProcedureReturningRows } from '../utils/spHelper.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGO_PATH = path.join(__dirname, '../../assets/logo_we.png')

// ─── Colores corporativos ────────────────────────────────────────────────────
const C = {
  navy:   '#1B2A47',
  teal:   '#2E86AB',
  white:  '#FFFFFF',
  light:  '#F4F6F9',
  muted:  '#6B7A8D',
  text:   '#1A1A2E',
  border: '#D1D9E6',
}

// ─── Tamaños base (ajusta aquí para escalar todo) ────────────────────────────
const F = {
  header:   8.5,  // cabeceras de sección
  label:    8.5,  // etiquetas de fila
  value:    8.5,  // valores de fila
  table:    8,    // tabla de módulos
  criteria: 8,    // texto de criterios
  footer:   7.5,  // pie de página
}
const ROW_H      = 18   // altura de filas de datos
const TABLE_ROW  = 16   // altura de filas en tabla de módulos
const CRIT_PAD   = 6    // padding vertical en filas de criterios

// ─── Helpers de fecha ────────────────────────────────────────────────────────
function parseLocalDate(str) {
  if (!str) return null
  const [y, m, d] = str.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d)
}

const MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio',
                   'agosto','septiembre','octubre','noviembre','diciembre']

function formatDateLong(dateObj) {
  if (!dateObj) return '—'
  return `${['domingo','lunes','martes','miércoles','jueves','viernes','sábado'][dateObj.getDay()]} ${dateObj.getDate()} de ${MONTHS_ES[dateObj.getMonth()]} ${dateObj.getFullYear()}`
}

function formatDateShort(str) {
  if (!str) return '—'
  const d = parseLocalDate(str)
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

function formatDateShortNoYear(str) {
  if (!str) return '—'
  const d = parseLocalDate(str)
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`
}

// Fecha de la N-ésima sesión válida
function getNthSession(startStr, allowedDays, totalSessions, holidaySet, n) {
  if (!startStr || allowedDays.length === 0) return null
  const iter = parseLocalDate(startStr)
  let counted = 0
  for (let i = 0; i < 1500; i++) {
    const dow = iter.getDay()
    const key = `${iter.getFullYear()}-${String(iter.getMonth()+1).padStart(2,'0')}-${String(iter.getDate()).padStart(2,'0')}`
    if (allowedDays.includes(dow) && !holidaySet.has(key)) {
      counted++
      if (counted === n) return new Date(iter)
      if (counted >= totalSessions) break
    }
    iter.setDate(iter.getDate() + 1)
  }
  return null
}

// Parsea variable_2 del catálogo
function getAllowedDays(dayCombos, catDayCombinationId) {
  const entry = dayCombos.find(c => c.id === catDayCombinationId || c.catalog_id === catDayCombinationId)
  if (!entry) return []
  try {
    if (entry.variable_2) {
      const parsed = JSON.parse(entry.variable_2)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {}
  return []
}

// Helper: obtener el id numérico de un hijo sea cual sea el campo
const resolveId = (c) => c.edition_num_id ?? c.child_edition_id ?? c.edition_id ?? c.id ?? c.num_id ?? null

// ─── Obtener jerarquía desde la BD ───────────────────────────────────────────
async function getEditionTree(editionNumId) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_edition_tree_get',
    [Number(editionNumId)],
    { statementTimeoutMs: 25000 }
  )
  return rows?.[0] || null
}

// ─── Generador del PDF ────────────────────────────────────────────────────────
export async function generateSchedulePdf(parentEditionId, childEditionId) {
  const [tree, catalog] = await Promise.all([
    getEditionTree(parentEditionId),
    getCatalog()
  ])

  if (!tree) throw new Error('Edición no encontrada')

  const dayCombos  = catalog['we_day_combination'] || []
  const holidays   = catalog['we_holiday'] || []
  const holidaySet = new Set(holidays.map(h => h.variable_3).filter(Boolean))

  // Resolver hijos y padre
  let children = []
  let parentInfo = {}
  const row = Array.isArray(tree) ? tree[0] : tree

  if (row.children) {
    parentInfo = {
      version_code:      row.version_code  || '',
      global_code:       row.global_code   || row.parent_global_code  || '',
      abbreviation:      row.program_public_label || row.abbreviation || row.parent_abbreviation || '',
      // El SP lo devuelve como cat_type_program_alias; el nombre corto quedo
      // como fallback por si el contrato del SP cambia. Sin esto isDiploma era
      // siempre false y el criterio de certificacion FGU salia en TODOS los PDF.
      program_type_alias: row.cat_type_program_alias || row.program_type_alias || '',
    }
    children = Array.isArray(row.children) ? row.children : JSON.parse(row.children || '[]')
  } else {
    parentInfo = {
      version_code:      row.version_code  || '',
      global_code:       row.global_code   || '',
      abbreviation:      row.program_public_label || row.abbreviation || '',
      // El SP lo devuelve como cat_type_program_alias; el nombre corto quedo
      // como fallback por si el contrato del SP cambia. Sin esto isDiploma era
      // siempre false y el criterio de certificacion FGU salia en TODOS los PDF.
      program_type_alias: row.cat_type_program_alias || row.program_type_alias || '',
    }
  }

  const child = children.find(c => resolveId(c) === Number(childEditionId))
  if (!child) throw new Error(`Módulo hijo no encontrado. ids: [${children.map(resolveId).join(',')}] | buscando: ${childEditionId}`)

  // Días permitidos (catálogo o fallback a weekday del start_date)
  let allowedDays = getAllowedDays(dayCombos, child.cat_day_combination_id)
  if (allowedDays.length === 0 && child.start_date) {
    allowedDays = [parseLocalDate(child.start_date).getDay()]
  }

  const totalSessions = Number(child.sessions) || 0
  const partialDate   = getNthSession(child.start_date, allowedDays, totalSessions, holidaySet, Math.min(3, totalSessions))
  const finalDate     = parseLocalDate(child.end_date)

  const lastChild   = children.reduce((prev, cur) => (!prev?.end_date || (cur.end_date && cur.end_date > prev.end_date)) ? cur : prev, children[0] || child)
  const lastEndDate = parseLocalDate(lastChild?.end_date)

  // ── Generar PDF ───────────────────────────────────────────────────────────
  return new Promise((resolve, reject) => {
    const PAGE_H = 841.89  // A4 alto en puntos
    const ML = 45           // margen izquierdo
    const MR = 45           // margen derecho
    const doc = new PDFDocument({ size: 'A4', margin: ML, bufferPages: true })
    const W   = doc.page.width - ML - MR

    const chunks = []
    doc.on('data', chunk => chunks.push(chunk))
    doc.on('end',  ()    => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    drawBrandHeader(doc, ML, W)

    // ── SECCIÓN 1: PROGRAMACIÓN DEL PROGRAMA ─────────────────────────────────
    sectionHeader(doc, ML, W, 'PROGRAMACIÓN DEL PROGRAMA')
    drawProgramInfo(doc, ML, W, parentInfo, children.length)

    moduleTable(doc, ML, W, children, Number(childEditionId))
    doc.y += 16

    // ── SECCIÓN 2: PROGRAMACIÓN DEL CURSO ────────────────────────────────────
    sectionHeader(doc, ML, W, 'PROGRAMACIÓN DEL CURSO')
    doc.y += 6

    // Fila nombre del módulo
    const yMod = doc.y
    doc.rect(ML, yMod, W, ROW_H + 2).fill(C.light).stroke(C.border)
    doc.fillColor(C.muted).font('Helvetica').fontSize(F.label).text('1', ML + 6, yMod + 6, { width: 16 })
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(F.label).text('Módulo:', ML + 24, yMod + 6, { width: 70 })
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(F.label + 0.5)
      .text((child.program_public_label || child.program_abreviature || child.abbreviation || '').toUpperCase(), ML + 100, yMod + 6, { width: W - 104 })
    doc.y = yMod + ROW_H + 2 + 4

    const dataRows = [
      { n: '1', label: 'Inicio de Clases',          value: formatDateLong(parseLocalDate(child.start_date)), bold: true  },
      { n: '2', label: 'Entregable Parcial',         value: formatDateLong(partialDate),                     bold: true  },
      { n: '3', label: 'Entregable Final',           value: formatDateLong(finalDate),                       bold: true  },
      { n: '4', label: 'Fin de Clases',              value: formatDateLong(finalDate),                       bold: false },
      { n: '5', label: 'Certificación del Curso',    value: 'Como máximo 7 días hábiles posterior a la fecha fin de clases', bold: false },
      { n: '6', label: 'Certificación del Programa', value: 'Como máximo 15 días hábiles posterior a la fecha fin de clases del último módulo', bold: false },
    ]

    drawDataRows(doc, ML, W, dataRows)
    doc.y += 16

    // ── SECCIÓN 3: CRITERIOS ──────────────────────────────────────────────────
    drawCriteria(doc, ML, W, parentInfo.program_type_alias)

    drawSignatureFooter(doc, ML, W)

    doc.end()
  })
}

// ─── Bloques de marca compartidos ─────────────────────────────────────────────
// Los dos PDFs que recibe el alumno (el de JERARQUIA y el adjunto al correo de
// inscripcion) son el mismo documento corporativo con distinto alcance. Estos
// bloques viven aca, y no duplicados en cada generador, para que no puedan
// divergir: si cambia la firma o un criterio, cambia en los dos a la vez.

const PAGE_MARGIN  = 45
const CONTENT_W    = 595.28 - PAGE_MARGIN * 2  // ancho util de la A4

function drawBrandHeader (doc, ml, w) {
  try { doc.image(LOGO_PATH, ml, 28, { height: 48 }) } catch {}

  doc.fontSize(8).fillColor(C.muted).font('Helvetica-Bold')
    .text('GERENTES FORMANDO', ml, 32, { width: w, align: 'right' })
    .text('FUTUROS GERENTES',  ml, 42, { width: w, align: 'right' })

  doc.moveTo(ml, 85).lineTo(ml + w, 85).strokeColor(C.navy).lineWidth(1.5).stroke()
  doc.y = 94
}

// Fila 1 — Programa: version_code | global_code | nombre publico
// Fila 2 — Modulos: N Modulo (s)
function drawProgramInfo (doc, ml, w, parentInfo, moduleCount) {
  const y = doc.y + 6

  doc.fillColor(C.muted).font('Helvetica').fontSize(F.label)
    .text('1', ml + 6, y, { width: 16 })
  doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(F.label)
    .text('Programa:', ml + 24, y, { width: 80 })
  doc.fillColor(C.muted).font('Helvetica').fontSize(F.label)
    .text(parentInfo.version_code || '', ml + 110, y, { width: 40 })
  doc.fillColor(C.border).font('Helvetica').fontSize(F.label)
    .text('|', ml + 152, y, { width: 10 })

  if (parentInfo.global_code) {
    doc.fillColor(C.teal).font('Helvetica-Bold').fontSize(F.label)
      .text(parentInfo.global_code, ml + 164, y, { width: 70 })
    doc.fillColor(C.border).font('Helvetica').fontSize(F.label)
      .text('|', ml + 236, y, { width: 10 })
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(F.label)
      .text(parentInfo.abbreviation || '', ml + 248, y, { width: w - 252 })
  } else {
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(F.label)
      .text(parentInfo.abbreviation || '', ml + 164, y, { width: w - 168 })
  }

  labelRow(doc, ml, w, y + 18, '2', 'Módulos:', `${moduleCount} Módulo (s)`)
  doc.y = y + 42
}

// Filas numeradas con cebra: N° | etiqueta | valor
function drawDataRows (doc, ml, w, rows) {
  let y = doc.y
  rows.forEach((r, i) => {
    const bg = i % 2 === 0 ? C.white : C.light
    doc.rect(ml, y, w, ROW_H).fill(bg).stroke(C.border)
    doc.fillColor(C.teal).font('Helvetica-Bold').fontSize(F.label)
      .text(r.n, ml + 6, y + 5, { width: 16 })
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(F.label)
      .text(r.label, ml + 24, y + 5, { width: 130 })
    doc.fillColor(C.text).font(r.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(F.value)
      .text(r.value || '—', ml + 160, y + 5, { width: w - 164 })
    y += ROW_H
  })
  doc.y = y
}

// El criterio de certificacion internacional (FGU) no aplica a los diplomados:
// esos certifican por WE y anunciarles un aval externo seria falso.
export function buildCriteria (programTypeAlias) {
  const isDiploma = programTypeAlias === 'we_program_type_diploma'
  return [
    'En caso de reprogramaciones de clases o inicios, estas serán comunicadas vía correo mediante el domínio <alumno.we@we-educación.com>, y a travéz del grupo de whatsapp del aula.',
    ...(!isDiploma ? ['En caso de certificación internacional, avalada por FGU (Florida Global University). Estas tienen un plazo de emisión de hasta 30 días hábiles posterior a la certificación del programa (emitida por WE Educación Ejecutiva).'] : []),
    'Toda entrega de documentos y comunicación formal se realizan vía correo <alumno.we@we-educacion.com>',
    'Ante cualquier duda o consulta comunicarse al siguiente número +51 922 744 702, o al siguiente enlace https://bit.ly/3LbMuGm',
  ]
}

function drawCriteria (doc, ml, w, programTypeAlias) {
  sectionHeader(doc, ml, w, 'CRITERIOS')
  doc.y += 4

  const yHead = doc.y
  doc.rect(ml, yHead, w, ROW_H).fill(C.light).stroke(C.border)
  doc.fillColor(C.text).font('Helvetica-Bold').fontSize(F.label)
    .text('N°', ml + 6, yHead + 5, { width: 24 })
    .text('Criterio', ml + 34, yHead + 5, { width: w - 38 })
  doc.y = yHead + ROW_H

  buildCriteria(programTypeAlias).forEach((text, i) => {
    const lines = Math.ceil(text.length / 100)
    const rowH  = Math.max(ROW_H, lines * (F.criteria + 3) + CRIT_PAD * 2)
    const yRow  = doc.y
    doc.rect(ml, yRow, w, rowH).fill(C.white).stroke(C.border)
    doc.fillColor(C.muted).font('Helvetica').fontSize(F.criteria)
      .text(String(i + 1), ml + 6, yRow + CRIT_PAD, { width: 24, align: 'center' })
    doc.fillColor(C.text).font('Helvetica').fontSize(F.criteria)
      .text(text, ml + 34, yRow + CRIT_PAD, { width: w - 42 })
    doc.y = yRow + rowH
  })
}

// Caso E0: el padre todavia no tiene edicion programada. Se avisa en el mismo
// PDF en vez de mandar una tabla de fechas vacia que el alumno leeria como error.
function drawPendingScheduleNote (doc, ml, w) {
  const y = doc.y
  const h = 34
  doc.rect(ml, y, w, h).fillAndStroke('#FEF3C7', '#FBBF24')
  doc.fillColor('#92400E').font('Helvetica-Bold').fontSize(F.label)
    .text('Cronograma pendiente', ml + 10, y + 6)
  doc.fillColor('#78350F').font('Helvetica').fontSize(F.criteria)
    .text('Las fechas, horarios y sesiones de cada módulo se asignarán al confirmar la edición programada. Recibirás el cronograma definitivo por correo.',
      ml + 10, y + 18, { width: w - 20 })
  doc.y = y + h
}

// Pie firmado: va pegado al contenido, no al borde de la hoja, para que no
// caiga solo en una segunda pagina cuando el programa tiene pocos modulos.
function drawSignatureFooter (doc, ml, w) {
  const footerY = doc.y + 14
  doc.moveTo(ml, footerY).lineTo(ml + w, footerY).strokeColor(C.border).lineWidth(0.5).stroke()

  const logoY = footerY + 8
  try { doc.image(LOGO_PATH, ml, logoY, { height: 36 }) } catch {}

  const tx = ml + 180
  doc.fillColor(C.text).font('Helvetica-Bold').fontSize(F.footer)
    .text('Alexandra Torres', tx, logoY, { width: 260 })
  doc.fillColor(C.muted).font('Helvetica').fontSize(F.footer)
    .text('Coordinación Académica',                      tx, logoY + 10, { width: 260 })
    .text('--------------------------------------',      tx, logoY + 19, { width: 260 })
    .text('+51 922 744 702',                             tx, logoY + 28, { width: 260 })
    .text('www.we-educacion.com',                        tx, logoY + 37, { width: 260 })
    .text('Av. Rep. de Panamá 3418-Piso 2 / San Isidro', tx, logoY + 46, { width: 260 })
}

// Anchos de la tabla de modulos, medidos con la fuente real del PDF
// (Helvetica 8pt) y no a ojo: la combinacion de dias mas larga del catalogo
// ("Lun-Mie-Vier") ocupa 45.8pt y el horario mas largo ("7:30PM - 10:00PM")
// 66.7pt. La suma debe caber en los ~501pt utiles del ancho A4 o la ultima
// columna se sale del margen derecho. Lo cuida tests/unit/pdf-cronograma.test.js.
export const MODULE_TABLE_COLS = { mod: 22, name: 132, fecha: 52, docente: 108, ses: 26, dia: 50, hora: 69, fin: 41 }

// ─── Helpers de dibujo ────────────────────────────────────────────────────────

function sectionHeader(doc, ml, w, title) {
  const y = doc.y
  doc.rect(ml, y, w, 20).fill(C.navy)
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(F.header)
    .text(title, ml + 10, y + 6, { width: w - 20 })
  doc.y = y + 24
}

function labelRow(doc, ml, w, y, num, label, value) {
  doc.fillColor(C.muted).font('Helvetica').fontSize(F.label)
    .text(num, ml + 6, y, { width: 16 })
  doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(F.label)
    .text(label, ml + 24, y, { width: 80 })
  doc.fillColor(C.text).font('Helvetica').fontSize(F.label)
    .text(value, ml + 110, y, { width: w - 114 })
}

function moduleTable(doc, ml, w, children, currentChildId) {
  const cols = MODULE_TABLE_COLS
  const hY   = doc.y

  // Cabecera teal
  doc.rect(ml, hY, w, TABLE_ROW).fill(C.teal)
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(F.table)
  const hdrs = [
    { label: 'Mod',          w: cols.mod   },
    { label: 'Nombre',       w: cols.name  },
    { label: 'Fecha Inicio', w: cols.fecha },
    { label: 'Docente',      w: cols.docente },
    { label: 'Ses',          w: cols.ses   },
    { label: 'Día',          w: cols.dia   },
    { label: 'Hora',         w: cols.hora  },
    { label: 'Fecha Fin',    w: cols.fin   },
  ]
  let cx = ml + 4
  hdrs.forEach(h => { doc.text(h.label, cx, hY + 5, { width: h.w - 2 }); cx += h.w })

  const romans = ['I','II','III','IV','V','VI','VII','VIII','IX','X']
  let rY = hY + TABLE_ROW

  children.forEach((ch, idx) => {
    const isCur = resolveId(ch) === currentChildId
    const bg    = isCur ? '#EBF4FF' : (idx % 2 === 0 ? C.white : C.light)
    doc.rect(ml, rY, w, TABLE_ROW).fill(bg).stroke(C.border)

    const sch     = (ch.schedules || [])[0] || {}
    const dayLbl  = sch.day_combination_label  || ch.day_combination_label  || '—'
    const hourLbl = sch.hour_combination_label || ch.hour_combination_label || '—'

    doc.fillColor(isCur ? C.teal : C.text).font(isCur ? 'Helvetica-Bold' : 'Helvetica').fontSize(F.table)
    cx = ml + 4
    const vals = [
      { val: romans[idx] || String(idx+1),                      w: cols.mod     },
      { val: ch.abbreviation , w: cols.name },
      { val: formatDateShort(ch.start_date),                    w: cols.fecha   },
      { val: ch.instructor_label || '—',                        w: cols.docente },
      { val: String(ch.sessions || '—'),                        w: cols.ses     },
      // El label del catalogo va entero: hay combinaciones de 1, 2 y 3 dias
      // ("Sab", "Mar-Jue", "Lun-Mie-Vier") y recortarlas cambia el horario que
      // lee el alumno.
      { val: dayLbl,                                            w: cols.dia     },
      { val: hourLbl,                                           w: cols.hora    },
      { val: formatDateShortNoYear(ch.end_date),                w: cols.fin     },
    ]
    vals.forEach(v => { doc.text(v.val, cx, rY + 5, { width: v.w - 2, ellipsis: true }); cx += v.w })
    rY += TABLE_ROW
  })

  doc.y = rY
}

// ─── PDF de cronograma de programa (para email de confirmación FICO) ──────────
export async function generateCronogramaPdf({ enrollmentId }) {
  // global_code vive en program_editions (no en program_versions). Si el
  // enrollment esta en E0 (sin edicion programada) sera NULL y el PDF sale sin
  // codigo de edicion: es correcto, todavia no se le asigno ninguna.
  const { rows } = await pool.query(`
    SELECT
      e.program_edition_id,
      e.program_version_id,
      pv.abbreviation  AS abbreviation,
      pv.version_code,
      pe.global_code,
      ct.alias         AS cat_type_program_alias
    FROM enrollments e
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN programs         pr ON pr.program_id         = pv.program_id
    LEFT JOIN catalog          ct ON ct.catalog_id         = pr.cat_type_program
    LEFT JOIN program_editions pe ON pe.edition_num_id     = e.program_edition_id
    WHERE e.enrollment_id = $1
  `, [enrollmentId])

  const enroll = rows?.[0]
  if (!enroll) throw new Error('Inscripción no encontrada para PDF cronograma')

  const parentEditionId = enroll.program_edition_id
  // E0 = padre sin edicion programada. Igual generamos el PDF con la estructura
  // del programa y las fechas pendientes; al confirmar la edicion el alumno
  // recibe el cronograma definitivo.
  const isE0 = !parentEditionId

  let children = []
  let parentInfo = {
    version_code:       enroll.version_code || '',
    global_code:        enroll.global_code || '',
    abbreviation:       enroll.abbreviation || '',
    program_type_alias: enroll.cat_type_program_alias || ''
  }

  if (isE0) {
    // Sin edicion no hay arbol: la estructura sale de las versiones, sin fechas
    // ni docentes ni horarios. La tabla los muestra como "—".
    const { rows: structRows } = await pool.query(`
      SELECT pv.abbreviation
      FROM program_version_structure pvs
      JOIN program_versions pv ON pv.program_version_id = pvs.child_program_version_id
      WHERE pvs.parent_program_version_id = $1
      ORDER BY pvs.sort_order
    `, [enroll.program_version_id])

    children = (structRows || []).map(r => ({ abbreviation: r.abbreviation }))
  } else {
    const tree = await getEditionTree(parentEditionId)
    if (!tree) throw new Error('Árbol de edición no encontrado')
    const row = Array.isArray(tree) ? tree[0] : tree
    children = Array.isArray(row.children) ? row.children
             : (row.children ? JSON.parse(row.children) : [])
    parentInfo = {
      version_code:       row.version_code || parentInfo.version_code,
      global_code:        row.global_code  || parentInfo.global_code,
      abbreviation:       row.program_public_label || row.abbreviation || parentInfo.abbreviation,
      program_type_alias: row.cat_type_program_alias || parentInfo.program_type_alias
    }
  }

  const ML = PAGE_MARGIN
  const W  = CONTENT_W

  const doc = new PDFDocument({ size: 'A4', margin: ML, bufferPages: true })
  const chunks = []
  doc.on('data', d => chunks.push(d))
  const pdfPromise = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  drawBrandHeader(doc, ML, W)

  // ── SECCIÓN 1: PROGRAMACIÓN DEL PROGRAMA ──────────────────────────────────
  sectionHeader(doc, ML, W, 'PROGRAMACIÓN DEL PROGRAMA')
  drawProgramInfo(doc, ML, W, parentInfo, children.length)

  // Sin modulo actual: este PDF cubre el programa entero, no un curso.
  moduleTable(doc, ML, W, children, null)
  doc.y += 16

  // ── SECCIÓN 2: FECHAS CLAVE ───────────────────────────────────────────────
  sectionHeader(doc, ML, W, 'FECHAS CLAVE DEL PROGRAMA')
  doc.y += 6

  if (isE0) {
    drawPendingScheduleNote(doc, ML, W)
  } else {
    const startDates = children.map(c => c.start_date).filter(Boolean).sort()
    const endDates   = children.map(c => c.end_date).filter(Boolean).sort()

    drawDataRows(doc, ML, W, [
      { n: '1', label: 'Inicio de Clases', value: formatDateLong(parseLocalDate(startDates[0])), bold: true },
      { n: '2', label: 'Fin de Clases',    value: formatDateLong(parseLocalDate(endDates[endDates.length - 1])), bold: true },
      { n: '3', label: 'Certificación del Curso',    value: 'Como máximo 7 días hábiles posterior a la fecha fin de clases', bold: false },
      { n: '4', label: 'Certificación del Programa', value: 'Como máximo 15 días hábiles posterior a la fecha fin de clases del último módulo', bold: false },
    ])
  }
  doc.y += 16

  // ── SECCIÓN 3: CRITERIOS ──────────────────────────────────────────────────
  drawCriteria(doc, ML, W, parentInfo.program_type_alias)

  drawSignatureFooter(doc, ML, W)

  doc.end()
  return pdfPromise
}
