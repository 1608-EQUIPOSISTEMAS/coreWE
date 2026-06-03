// Mapeo de filas de enrollment_audit_log hacia el shape que consume el cliente.
// Hoy es passthrough (paridad con getAuditLog del service legacy, que devolvia
// las filas tal cual). Mantener este borde explicito permite endurecer a una
// allowlist sin tocar el repository cuando el contrato con el front este fijado.

export const toAuditEntryDto = row => row

export const toAuditLogDto = rows => (rows || []).map(toAuditEntryDto)
