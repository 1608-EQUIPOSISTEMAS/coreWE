// Salida de la conciliacion para el cliente. Snake_case como el resto de la API.
// Las filas ya vienen filtradas (solo las que tienen diferencias). `sheet` dice
// de que hoja (1, 2...) salio la fila cuando se concilian varias.

export function toReconciliationDto ({ summary, rows, versionCodes, sheets = [], replaced = 0 }) {
  return {
    version_codes: versionCodes,
    sheets,
    summary: { ...summary, repeated_across_sheets: replaced },
    rows: rows.map(r => ({
      row_number: r.row_number,
      sheet: r.sheet ?? null,
      enrollment_id: r.enrollment_id,
      student: r.student,
      document_number: r.document_number,
      edition: r.edition,
      mode: r.mode,
      findings: r.findings.map(f => ({ code: f.code, severity: f.severity, message: f.message, sheet: f.sheet, db: f.db }))
    }))
  }
}
