import { describe, it, expect } from 'vitest'
import PDFDocument from 'pdfkit'
import { MODULE_TABLE_COLS, buildCriteria } from '../../src/services/pdf.service.js'

// La columna Dia del cronograma solia recortar a 8 caracteres y "Lun-Mie-Vier"
// llegaba al alumno como "Lun-Mie-". Estos son los labels vivos del catalogo
// we_day_combination (1, 2 y 3 dias). Si se agrega uno mas largo, este test
// falla y hay que re-medir los anchos, no recortar el texto.
const DAY_LABELS = ['Jue', 'Vie', 'Sáb', 'Dom', 'Martes', 'Mie',
  'Mar-Jue', 'Lun-Mie', 'Vier-Sáb', 'Sáb-Dom', 'Mier-Vier', 'Lun-Mie-Vier']

const HOUR_LABELS = ['9AM - 12PM', '3PM - 6PM', '7PM - 10PM', '10AM - 1PM',
  '7PM - 9PM', '3:30PM - 7:30PM', '7:30PM - 10:00PM', '10AM - 2PM', '9AM - 1PM', '3PM - 7PM']

const A4_USABLE_WIDTH = 501 // 595.28pt - 45pt de margen a cada lado - 4pt de sangria

function measure (text, font) {
  const doc = new PDFDocument({ size: 'A4' })
  doc.font(font).fontSize(8)
  const width = doc.widthOfString(text)
  doc.end()
  return width
}

describe('tabla de modulos del PDF de cronograma', () => {
  it('cabe entera en el ancho util de la A4', () => {
    const total = Object.values(MODULE_TABLE_COLS).reduce((a, b) => a + b, 0)
    expect(total).toBeLessThanOrEqual(A4_USABLE_WIDTH)
  })

  it.each(DAY_LABELS)('muestra "%s" sin recortar', (label) => {
    expect(measure(label, 'Helvetica')).toBeLessThanOrEqual(MODULE_TABLE_COLS.dia - 2)
  })

  it.each(HOUR_LABELS)('muestra "%s" sin recortar', (label) => {
    expect(measure(label, 'Helvetica')).toBeLessThanOrEqual(MODULE_TABLE_COLS.hora - 2)
  })
})

// El aval internacional FGU no aplica a los diplomados: certifican por WE y
// anunciar un aval externo seria falso. La regla estaba rota porque el codigo
// leia `program_type_alias` y el SP devuelve `cat_type_program_alias`.
describe('criterios del PDF de cronograma', () => {
  const FGU = /Florida Global University/

  it('omite el aval FGU en los diplomados', () => {
    expect(buildCriteria('we_program_type_diploma').some(c => FGU.test(c))).toBe(false)
  })

  it.each(['we_program_type_pee', 'we_program_type_specialization', 'we_program_type_course', ''])(
    'incluye el aval FGU en %s', (alias) => {
      expect(buildCriteria(alias).some(c => FGU.test(c))).toBe(true)
    })
})
