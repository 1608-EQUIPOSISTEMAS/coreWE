// Borde de salida de la exportacion del aula virtual. Passthrough hoy (paridad
// con el service legacy); endurecer a allowlist si el contrato con el front se
// fija. Centralizar el mapeo aqui evita que un cambio de columna se filtre.

export const toExportOptionsDto = programs => programs

export const toClassroomCsvDto = csv => csv
