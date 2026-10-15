import { reconciliationRepository } from './reconciliation.repository.js'
import { reconcile, normText, mergeSheets } from './reconciliation.entity.js'
import { toReconciliationDto } from './reconciliation.dto.js'
import { parseSheetRows } from '../importer.usecases.js'
import { DomainError } from '../../../shared/errors.js'

// Orquesta la conciliacion hoja FICO <-> sistema: lee las hojas con el MISMO
// parser que importa (incluidas las filas R, para verificar que no esten
// activas), trae de la BD lo necesario en pocas queries y delega la comparacion
// en la entity. Solo lectura.
//
// Un programa vive en una hoja por año (BI-EZ-01 2025 y 2026) y la BD es una
// sola: se concilian juntas. Si una fila se repite entre hojas, manda la
// ULTIMA de la lista (la mas reciente: esa venta ya cuenta como de ese año).

const repo = reconciliationRepository

export async function reconcileFicoSheets ({ urls }) {
  const sheets = []
  for (const url of urls) {
    sheets.push(await parseSheetRows('enrollment_fico', url, { includeExcluded: true }))
  }
  const { rows, replaced } = mergeSheets(sheets)
  const versionCodes = [...new Set(rows.map(r => String(r.raw.course_code || '').trim()).filter(Boolean))]
  if (!versionCodes.length) throw new DomainError('Las hojas no traen codigos de curso (columna COD).')

  const documentNumbers = [...new Set(rows.map(r => String(r.raw.document_number || '').trim()).filter(Boolean))]
  const [activeEditions, enrollments, related] = await Promise.all([
    repo.activeEditions(versionCodes),
    repo.enrollmentsByVersions(versionCodes),
    // Mismos alumnos en cualquier programa: destinos de CC y destinos sueltos.
    repo.enrollmentsByDocuments(documentNumbers)
  ])
  const structure = await repo.structure(activeEditions.map(a => Number(a.program_edition_id)))

  const result = reconcile({ rows, enrollments, related, activeEditions, structure })
  return toReconciliationDto({
    ...result,
    versionCodes: versionCodes.map(c => normText(c).toUpperCase()),
    sheets: sheets.map((s, i) => ({ sheet: i + 1, rows: s.length })),
    replaced
  })
}
