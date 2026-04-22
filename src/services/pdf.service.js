import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool } from '../config/db.js'
import { callProcedureReturningRows } from '../utils/spHelper.js'
import { buildCronogramaHTML } from '../templates/cronograma-pdf.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HEADER_IMG_PATH = path.join(__dirname, '..', 'assets', 'cronograma-header.png')
let headerDataUri = ''
try {
  const buffer = fs.readFileSync(HEADER_IMG_PATH)
  headerDataUri = `data:image/png;base64,${buffer.toString('base64')}`
} catch (err) {
  console.warn('[pdf.service] Header image not found:', err.message)
}

export async function generateCronogramaPdfByIds ({ programVersionId, programEditionId }) {
  const treeRows = await callProcedureReturningRows(
    pool,
    'public.sp_edition_tree_get',
    [programEditionId],
    { statementTimeoutMs: 20000 }
  )

  const tree = treeRows?.[0]
  if (!tree) throw new Error('Edicion no encontrada')
  if (tree.program_version_id !== programVersionId) {
    throw new Error(`La edicion ${programEditionId} no pertenece al programa ${programVersionId}`)
  }

  const { rows: structure } = await pool.query(`
    SELECT child_program_version_id, sort_order
    FROM program_version_structure
    WHERE parent_program_version_id = $1
    ORDER BY sort_order
  `, [programVersionId])

  if (!structure.length) throw new Error('El programa no tiene modulos hijos')

  const childByPv = {}
  for (const ch of (tree.children || [])) {
    if (ch.child_program_version_id) childByPv[ch.child_program_version_id] = ch
  }

  const modules = structure.map(s => {
    const ch = childByPv[s.child_program_version_id]
    if (!ch) {
      return { name: null, start_date: null, end_date: null, instructor: null, sessions: null, day: null, hour: null }
    }
    return {
      name: ch.abbreviation || null,
      start_date: ch.start_date,
      end_date: ch.end_date,
      instructor: ch.instructor_label && ch.instructor_label.trim() ? ch.instructor_label : '—',
      sessions: ch.sessions,
      day: ch.day_combination_label || '—',
      hour: ch.hour_combination_label || '—'
    }
  })

  const today = new Date()
  const currentModule = modules.find(m => {
    if (!m?.start_date) return false
    const start = new Date(m.start_date)
    const end = m.end_date ? new Date(m.end_date) : null
    return start <= today && (!end || end >= today)
  }) || modules.find(m => m?.start_date) || modules[0]

  const html = buildCronogramaHTML({
    program: {
      code: tree.program_id ? `${tree.cat_category_label || ''}` : '',
      name: tree.program_name || tree.abbreviation || '—',
      abbreviation: tree.abbreviation || ''
    },
    edition: {
      code: tree.global_code || '—',
      start_date: tree.start_date,
      end_date: tree.end_date
    },
    modules,
    currentModule,
    headerImage: headerDataUri
  })

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'domcontentloaded' })
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' }
    })
    return buffer
  } finally {
    await browser.close()
  }
}

export async function generateCronogramaPdf ({ enrollmentId }) {
  const { rows } = await pool.query(
    'SELECT program_version_id, program_edition_id FROM enrollments WHERE enrollment_id = $1',
    [enrollmentId]
  )
  const e = rows?.[0]
  if (!e) throw new Error('Inscripcion no encontrada')
  return generateCronogramaPdfByIds({
    programVersionId: e.program_version_id,
    programEditionId: e.program_edition_id
  })
}
