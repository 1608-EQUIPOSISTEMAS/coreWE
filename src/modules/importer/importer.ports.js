// Puertos del modulo de importacion. Los importadores necesitan funciones que
// viven en OTROS modulos (registrar inscripciones, leer catalogos, listar
// programas/ediciones), pero la regla de aislamiento (boundaries) prohibe
// importarlas directamente. En su lugar se inyectan aqui desde el composition
// root (buildApp.js) via setImporterPorts. Asi el modulo importer declara QUE
// necesita sin acoplarse al COMO de cada modulo dueño.

export const importerPorts = {
  // (data, { userId }) -> respuesta del registro directo FICO.
  registerEnrollment: null,
  // () -> mapa de catalogos { categoria: [{ id, alias, abbreviation, description }] }.
  getCatalog: null,
  // (payload) -> { items: [versiones de programa] }.
  listProgramVersions: null,
  // (programVersionId) -> [{ edition_num_id, global_code, start_date }].
  listEditionsByVersion: null,
  // (codigoEdicion) -> { program_edition_id, program_version_id } | null.
  // Usado por la hoja FICO para resolver la columna ED. Puede quedar null si
  // aun no se cableo: el adaptador lo reporta como error legible por fila.
  findEditionByCode: null
}

export function setImporterPorts (ports = {}) {
  Object.assign(importerPorts, ports)
}
