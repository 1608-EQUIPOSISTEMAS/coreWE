import PDFDocument from 'pdfkit'
import path from 'path'
import { fileURLToPath } from 'url'
import { getCatalog } from './catalog.service.js'
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

// Suma N días hábiles (lun-vie), saltando feriados
function addBusinessDays(dateObj, days, holidaySet) {
  let d = new Date(dateObj)
  let count = 0
  while (count < days) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    if (dow !== 0 && dow !== 6 && !holidaySet.has(key)) count++
  }
  return d
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
      program_type_alias: row.program_type_alias || '',
    }
    children = Array.isArray(row.children) ? row.children : JSON.parse(row.children || '[]')
  } else {
    parentInfo = {
      version_code:      row.version_code  || '',
      global_code:       row.global_code   || '',
      abbreviation:      row.program_public_label || row.abbreviation || '',
      program_type_alias: row.program_type_alias || '',
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

    // ── HEADER ───────────────────────────────────────────────────────────────
    try { doc.image(LOGO_PATH, ML, 28, { height: 48 }) } catch {}

    doc.fontSize(8).fillColor(C.muted).font('Helvetica-Bold')
      .text('GERENTES FORMANDO', ML, 32, { width: W, align: 'right' })
      .text('FUTUROS GERENTES',  ML, 42, { width: W, align: 'right' })

    doc.moveTo(ML, 85).lineTo(ML + W, 85).strokeColor(C.navy).lineWidth(1.5).stroke()
    doc.y = 94

    // ── SECCIÓN 1: PROGRAMACIÓN DEL PROGRAMA ─────────────────────────────────
    sectionHeader(doc, ML, W, 'PROGRAMACIÓN DEL PROGRAMA')

    const yInfo = doc.y + 6

    // Fila 1 — Programa: código | clasificación | nombre público
    doc.fillColor(C.muted).font('Helvetica').fontSize(F.label)
      .text('1', ML + 6, yInfo, { width: 16 })
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(F.label)
      .text('Programa:', ML + 24, yInfo, { width: 80 })
    // 1er campo: version_code (gris, tipo "E35")
    doc.fillColor(C.muted).font('Helvetica').fontSize(F.label)
      .text(parentInfo.version_code, ML + 110, yInfo, { width: 40 })
    // Separador
    doc.fillColor(C.border).font('Helvetica').fontSize(F.label)
      .text('|', ML + 152, yInfo, { width: 10 })
    // 2do campo: global_code (teal, tipo "DL:DS:34")
    if (parentInfo.global_code) {
      doc.fillColor(C.teal).font('Helvetica-Bold').fontSize(F.label)
        .text(parentInfo.global_code, ML + 164, yInfo, { width: 70 })
      doc.fillColor(C.border).font('Helvetica').fontSize(F.label)
        .text('|', ML + 236, yInfo, { width: 10 })
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(F.label)
        .text(parentInfo.abbreviation, ML + 248, yInfo, { width: W - 252 })
    } else {
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(F.label)
        .text(parentInfo.abbreviation, ML + 164, yInfo, { width: W - 168 })
    }

    labelRow(doc, ML, W, yInfo + 18, '2', 'Módulos:',  `${children.length} Módulo (s)`)
    doc.y = yInfo + 42

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

    let yCur = doc.y
    dataRows.forEach((r, i) => {
      const bg = i % 2 === 0 ? C.white : C.light
      doc.rect(ML, yCur, W, ROW_H).fill(bg).stroke(C.border)
      doc.fillColor(C.teal).font('Helvetica-Bold').fontSize(F.label)
        .text(r.n, ML + 6, yCur + 5, { width: 16 })
      doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(F.label)
        .text(r.label, ML + 24, yCur + 5, { width: 130 })
      doc.fillColor(C.text).font(r.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(F.value)
        .text(r.value || '—', ML + 160, yCur + 5, { width: W - 164 })
      yCur += ROW_H
    })

    doc.y = yCur + 16

    // ── SECCIÓN 3: CRITERIOS ──────────────────────────────────────────────────
    sectionHeader(doc, ML, W, 'PROGRAMACIÓN DEL CURSO')
    doc.y += 4

    // Cabecera criterios
    const yCH = doc.y
    doc.rect(ML, yCH, W, ROW_H).fill(C.light).stroke(C.border)
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(F.label)
      .text('N°', ML + 6, yCH + 5, { width: 24 })
      .text('Critério', ML + 34, yCH + 5, { width: W - 38 })
    doc.y = yCH + ROW_H

    const isDiploma = parentInfo.program_type_alias === 'we_program_type_diploma'

    const criteria = [
      'En caso de reprogramaciones de clases o inicios, estas serán comunicadas vía correo mediante el domínio <alumno.we@we-educación.com>, y a travéz del grupo de whatsapp del aula.',
      ...(!isDiploma ? ['En caso de certificación internacional, avalada por FGU (Florida Global University). Estas tienen un plazo de emisión de hasta 30 días hábiles posterior a la certificación del programa (emitida por WE Educación Ejecutiva).'] : []),
      'Toda entrega de documentos y comunicación formal se realizan vía correo <alumno.we@we-educacion.com>',
      'Ante cualquier duda o consulta comunicarse al siguiente número +51 922 744 702, o al siguiente enlace https://bit.ly/3LbMuGm',
    ]

    criteria.forEach((text, i) => {
      const lines  = Math.ceil(text.length / 100)
      const rowH   = Math.max(ROW_H, lines * (F.criteria + 3) + CRIT_PAD * 2)
      const yRow   = doc.y
      doc.rect(ML, yRow, W, rowH).fill(C.white).stroke(C.border)
      doc.fillColor(C.muted).font('Helvetica').fontSize(F.criteria)
        .text(String(i + 1), ML + 6, yRow + CRIT_PAD, { width: 24, align: 'center' })
      doc.fillColor(C.text).font('Helvetica').fontSize(F.criteria)
        .text(text, ML + 34, yRow + CRIT_PAD, { width: W - 42 })
      doc.y = yRow + rowH
    })

    // ── FOOTER — siempre en la misma página, después del contenido ───────────
    const footerY = doc.y + 14
    doc.moveTo(ML, footerY).lineTo(ML + W, footerY).strokeColor(C.border).lineWidth(0.5).stroke()

    const logoY = footerY + 8
    try { doc.image(LOGO_PATH, ML, logoY, { height: 36 }) } catch {}

    // Texto del footer alineado al centro-derecha
    const FTX = ML + 180
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(F.footer)
      .text('Alexandra Torres', FTX, logoY, { width: 260 })
    doc.fillColor(C.muted).font('Helvetica').fontSize(F.footer)
      .text('Coordinación Académica',                       FTX, logoY + 10, { width: 260 })
      .text('--------------------------------------',        FTX, logoY + 19, { width: 260 })
      .text('+51 922 744 702',                               FTX, logoY + 28, { width: 260 })
      .text('www.we-educacion.com',                          FTX, logoY + 37, { width: 260 })
      .text('Av. Rep. de Panamá 3418-Piso 2 / San Isidro',  FTX, logoY + 46, { width: 260 })

    doc.end()
  })
}

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
  // anchos de columna (suma = w)
  const cols = { mod: 22, name: 118, fecha: 62, docente: 108, ses: 26, dia: 42, hora: 68, fin: 69 }
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
      { val: dayLbl.substring(0, 8),                            w: cols.dia     },
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
  // Obtener la edición padre asociada a la inscripción
  const { rows } = await pool.query(`
    SELECT
      e.program_edition_id,
      e.program_version_id,
      pv.abbreviation  AS program_name,
      pv.version_code,
      pv.global_code
    FROM enrollments e
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    WHERE e.enrollment_id = $1
  `, [enrollmentId])

  const enroll = rows?.[0]
  if (!enroll) throw new Error('Inscripción no encontrada para PDF cronograma')

  const parentEditionId = enroll.program_edition_id
  // E0 = padre sin edicion programada. Igual generamos el PDF mostrando la
  // estructura del programa (modulos del program_version_structure) con fechas
  // pendientes; al confirmar la edicion el alumno recibira el cronograma final.
  const isE0 = !parentEditionId

  let children = []
  let catalog = {}

  if (isE0) {
    // Sin edicion: traemos la estructura del programa directo (sin fechas).
    const { rows: structRows } = await pool.query(`
      SELECT
        pvs.child_program_version_id,
        pvs.sort_order,
        pv.abbreviation  AS abbreviation,
        pv.global_code   AS global_code
      FROM program_version_structure pvs
      JOIN program_versions pv ON pv.program_version_id = pvs.child_program_version_id
      WHERE pvs.parent_program_version_id = $1
      ORDER BY pvs.sort_order
    `, [enroll.program_version_id])

    children = (structRows || []).map(r => ({
      program_public_label: r.abbreviation || r.global_code,
      program_abreviature: r.abbreviation,
      abbreviation: r.abbreviation,
      start_date: null,
      end_date: null,
      sessions: null,
      cat_day_combination_id: null
    }))
  } else {
    const [tree, cat] = await Promise.all([
      getEditionTree(parentEditionId),
      getCatalog()
    ])
    if (!tree) throw new Error('Árbol de edición no encontrado')
    const row = Array.isArray(tree) ? tree[0] : tree
    children = Array.isArray(row.children) ? row.children
             : (row.children ? JSON.parse(row.children) : [])
    catalog = cat || {}
  }

  const dayCombos  = catalog['we_day_combination'] || []
  const holidays   = catalog['we_holiday'] || []
  const holidaySet = new Set(holidays.map(h => h.variable_3).filter(Boolean))

  const fmtDate = (d) => {
    if (!d) return '—'
    const obj = (d instanceof Date) ? d : parseLocalDate(d)
    if (isNaN(obj)) return '—'
    return obj.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  // ── Construir el PDF ────────────────────────────────────────────────────────
  const ML = 40, MT = 40
  const PAGE_W = 595.28

  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true })
  const chunks = []
  doc.on('data', d => chunks.push(d))
  const pdfPromise = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  // Encabezado
  doc.rect(0, 0, PAGE_W, 70).fill(C.navy)
  try { doc.image(LOGO_PATH, ML, 17, { height: 36 }) } catch {}
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(13)
     .text(isE0 ? 'Estructura del Programa' : 'Cronograma del Programa', 0, 22, { align: 'center' })
  doc.font('Helvetica').fontSize(9).fillColor('#B0C4DE')
     .text(enroll.program_name || '', 0, 40, { align: 'center' })

  let y = 90

  // Nota explicativa para E0 (programa padre sin edicion programada)
  if (isE0) {
    const noteH = 36
    doc.rect(ML, y, PAGE_W - 2 * ML, noteH).fill('#FEF3C7').stroke('#FBBF24').lineWidth(0.5)
    doc.fillColor('#92400E').font('Helvetica-Bold').fontSize(8)
       .text('Cronograma pendiente', ML + 10, y + 6)
    doc.font('Helvetica').fontSize(8).fillColor('#78350F')
       .text('Las fechas, horarios y sesiones de cada modulo se asignaran al confirmar la edicion programada. Recibiras el cronograma definitivo por correo.', ML + 10, y + 18, { width: PAGE_W - 2 * ML - 20 })
    y += noteH + 10
  }

  // Cabecera tabla
  const COL = { num: 30, name: 200, start: 80, end: 80, days: 75, hours: 75 }
  const cols = [
    { label: 'N°',        w: COL.num  },
    { label: 'Módulo',    w: COL.name },
    { label: 'Inicio',    w: COL.start },
    { label: 'Fin',       w: COL.end  },
    { label: 'Días',      w: COL.days },
    { label: 'Sesiones',  w: COL.hours },
  ]
  const totalW = cols.reduce((s, c) => s + c.w, 0)

  doc.rect(ML, y, totalW, 18).fill(C.navy)
  let cx = ML
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.white)
  cols.forEach(c => {
    doc.text(c.label, cx + 3, y + 5, { width: c.w - 6, align: 'left' })
    cx += c.w
  })
  y += 18

  // Filas de módulos
  children.forEach((ch, idx) => {
    let allowedDays = getAllowedDays(dayCombos, ch.cat_day_combination_id)
    if (allowedDays.length === 0 && ch.start_date) {
      allowedDays = [parseLocalDate(ch.start_date).getDay()]
    }
    const dayLabels = {0:'Dom',1:'Lun',2:'Mar',3:'Mié',4:'Jue',5:'Vie',6:'Sáb'}
    const daysStr = allowedDays.map(d => dayLabels[d] || '').filter(Boolean).join(', ')

    const bg = idx % 2 === 0 ? C.white : C.light
    doc.rect(ML, y, totalW, 20).fill(bg)
    doc.rect(ML, y, totalW, 20).stroke(C.border).lineWidth(0.3)

    const vals = [
      String(idx + 1),
      ch.program_public_label || ch.program_abreviature || ch.abbreviation || '—',
      fmtDate(ch.start_date),
      fmtDate(ch.end_date),
      daysStr || '—',
      String(ch.sessions || '—'),
    ]
    cx = ML
    doc.font('Helvetica').fontSize(8).fillColor(C.text)
    cols.forEach((c, i) => {
      doc.text(vals[i], cx + 3, y + 6, { width: c.w - 6, ellipsis: true })
      cx += c.w
    })
    y += 20
  })

  // Footer relativo
  y += 14
  doc.moveTo(ML, y).lineTo(ML + totalW, y).strokeColor(C.border).lineWidth(0.5).stroke()
  y += 8
  try { doc.image(LOGO_PATH, ML, y, { height: 28 }) } catch {}
  doc.font('Helvetica').fontSize(7).fillColor(C.muted)
     .text('WE Educación — Documento generado automáticamente', ML + 80, y + 8, { width: totalW - 80 })

  doc.end()
  return pdfPromise
}
