// Salida de la conciliacion para el cliente. Snake_case como el resto de la API.
// Las filas ya vienen filtradas (solo las que tienen diferencias). `sheet` dice
// de que hoja (1, 2...) salio la fila cuando se concilian varias. `fixes` son
// las correcciones que se pueden aplicar a la fila (blocked = motivo por el que
// esa no se puede hacer sola). El contexto interno (_ctx) no sale.

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
      findings: r.findings.map(f => ({ code: f.code, severity: f.severity, message: f.message, sheet: f.sheet, db: f.db })),
      fixes: (r.fixes || []).map(f => ({
        action: f.action,
        label: f.label,
        risk: f.risk,
        codes: f.codes,
        description: f.description,
        changes: f.changes,
        blocked: f.blocked
      }))
    }))
  }
}

export function toFixResultsDto (results) {
  return {
    applied: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results: results.map(r => ({
      action: r.action,
      label: r.label,
      enrollment_id: r.enrollment_id ?? null,
      row_number: r.row_number ?? null,
      sheet: r.sheet ?? null,
      ok: r.ok,
      message: r.message
    }))
  }
}
