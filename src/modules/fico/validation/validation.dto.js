// Mapeo del borde de salida del subdominio de convalidaciones. Hoy passthrough,
// en paridad con el service legacy (las rutas devolvian las filas crudas y el
// objeto resultado tal cual). Mantener este borde explicito permite endurecer a
// allowlist sin tocar usecases ni controller cuando el contrato con el front se
// fije.

export const toValidationsDto = rows => rows

export const toSaveResultDto = result => result

export const toProgramChildrenDto = rows => rows
