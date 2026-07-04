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
  // () -> [{ program_edition_id, program_version_id, version_code, global_code }]
  // de todas las ediciones activas. La hoja FICO lo indexa una vez por archivo y
  // resuelve la columna ED en memoria (en vez de 1 query por fila).
  listActiveEditions: null,
  // () -> [{ program_version_id, program_id, abbreviation }] de programas-membresia.
  // La hoja FICO lo usa para crear la inscripcion de membresia segun la columna J
  // y para persistir el tier (enrollments.membership_program_id) en el curso.
  listMembershipVersions: null,
  // () -> [{ user_id, alias }] de asesores. La hoja FICO resuelve la columna AS
  // (codigo de agente) a seller_agent_id.
  listAgents: null,
  // ({ enrollmentId, sellerAgentId, agentOrigin }) -> void. Completa el asesor de
  // una inscripcion existente al re-importar (cuando salio duplicada).
  updateEnrollmentAgent: null,
  // () -> [{ parent_edition_id, child_edition_id, child_version_id }]. Estructura
  // padre->aulas hijas; la hoja FICO crea las inscripciones hijas de un paquete.
  listEditionStructure: null,
  // () -> [{ account_id, business_entity_catalog_id, bank_name, currency }]. La hoja
  // FICO resuelve "ENTIDAD FINANCIERA" (+ empresa + moneda) a bank_account_id.
  listBankAccounts: null,
  // () -> [{ catalog_id, alias }] de monedas (SOLES/DOLARES). Necesario porque el
  // grupo we_currency esta inactivo y no llega en getCatalog.
  listCurrencies: null
}

export function setImporterPorts (ports = {}) {
  Object.assign(importerPorts, ports)
}
