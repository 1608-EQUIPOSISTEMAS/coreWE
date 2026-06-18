import { enrollmentImporter } from './importers/enrollment.importer.js'
import { enrollmentFicoImporter } from './importers/enrollment-fico.importer.js'
import { NotFoundError } from '../../shared/errors.js'

// Registro de importadores disponibles. Para sumar una entidad nueva (Alumnos,
// Pagos, ...) se crea su archivo en importers/ y se agrega aqui: nada mas en el
// controlador, rutas o frontend cambia.
const IMPORTERS = {
  [enrollmentImporter.key]: enrollmentImporter,
  [enrollmentFicoImporter.key]: enrollmentFicoImporter
}

// Devuelve el importador o lanza 404 si la entidad no existe. Centraliza el
// mensaje de error para todos los endpoints.
export function getImporter (entity) {
  const def = IMPORTERS[entity]
  if (!def) throw new NotFoundError(`Entidad de importacion desconocida: "${entity}"`)
  return def
}

// Lista liviana para poblar el selector de entidades del frontend. No expone
// las funciones internas (loadContext/resolveRow/commitRow), solo metadatos.
export function listImporters () {
  return Object.values(IMPORTERS).map(def => ({
    key: def.key,
    label: def.label,
    description: def.description,
    acceptsUrl: def.acceptsUrl === true,
    hasTemplate: typeof def.ingest !== 'function'
  }))
}
